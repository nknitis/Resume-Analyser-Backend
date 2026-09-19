import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Candidate from "../models/Candidate.js";
import Job from "../models/Job.js";
import nodemailer from "nodemailer";

function getGeminiClient() {
  const key = process.env.GEMINI_API_KEY || process.env.GEMINI;
  return key ? new GoogleGenerativeAI(key) : null;
}

function cleanModelJson(text = "") {
  return text.replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim();
}
function safeJsonParse(text = "") {
  try { return JSON.parse(cleanModelJson(text)); } catch { return null; }
}
function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(v => String(v || "").trim()).filter(Boolean))].slice(0, 12);
}

const COMMON_SKILLS = [
  "javascript","typescript","react","react.js","node.js","node","express","express.js",
  "mongodb","mysql","postgresql","sql","redis","docker","kubernetes","aws","azure","gcp",
  "java","spring boot","python","django","flask","c++","c","git","github","rest api",
  "restful api","graphql","next.js","html","css","tailwind","redux","nestjs","microservices",
  "system design","machine learning","deep learning","nlp","generative ai","genai","rag",
  "embeddings","vector database","vector db","langchain","llm","gemini","openai"
];

function extractSkills(text = "") {
  const lower = text.toLowerCase();
  return COMMON_SKILLS.filter(skill => lower.includes(skill.toLowerCase()));
}
function extractEmail(text = "") {
  return (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [""])[0];
}
function extractPhone(text = "") {
  return (text.match(/(?:\+91[-\s]?)?[6-9]\d{9}/) || [""])[0];
}
function firstUsefulLine(text = "") {
  return text.split(/\r?\n/).map(s => s.trim()).find(s =>
    s && s.length >= 2 && s.length <= 80 && !/@/.test(s) && !/resume|curriculum vitae|phone|email/i.test(s)
  ) || "";
}
function extractSection(text, headings) {
  const escaped = headings.map(h => h.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(?:^|\\n)\\s*(?:${escaped})\\s*:?\\s*\\n([\\s\\S]*?)(?=\\n\\s*(?:education|experience|work experience|skills|projects|certifications|summary|objective|achievements|technical skills)\\s*:??\\s*\\n|$)`, "i");
  return (text.match(re)?.[1] || "").trim().slice(0, 5000);
}
function extractResumeDetails(text = "") {
  return {
    education: extractSection(text, ["education","academic background"]),
    experience: extractSection(text, ["experience","work experience","employment"]),
    projects: extractSection(text, ["projects","project experience"]),
    certifications: extractSection(text, ["certifications","certificates"])
  };
}
function tokenize(text = "") {
  return new Set(text.toLowerCase().replace(/[^a-z0-9+#.\- ]/g, " ").split(/\s+/).filter(t => t.length > 2));
}
function keywordScore(jobDescription = "", resumeText = "", resumeSkills = []) {
  const jobTokens = tokenize(jobDescription);
  const resumeTokens = tokenize(resumeText);
  const matched = [...jobTokens].filter(t => resumeTokens.has(t));
  const skillHits = resumeSkills.filter(s => jobDescription.toLowerCase().includes(s.toLowerCase()));
  const score = Math.min(100, Math.round(((matched.length + skillHits.length * 2) / Math.max(jobTokens.size + skillHits.length * 2, 1)) * 100));
  return { score, matchedKeywords: [...new Set([...matched, ...skillHits])].slice(0, 30) };
}
function chunkText(text = "", size = 900, overlap = 150) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const chunks = [];
  for (let start = 0; start < clean.length; start += size - overlap) {
    const chunk = clean.slice(start, start + size);
    if (chunk) chunks.push(chunk);
    if (chunks.length >= 8) break;
  }
  return chunks;
}
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function embedText(text, taskType = "RETRIEVAL_DOCUMENT") {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI;
  if (!apiKey) throw new Error("Gemini API key is missing. Set GEMINI_API_KEY in backend/.env.");
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 12000) }] }, taskType, outputDimensionality: 768 })
  });
  if (!response.ok) throw new Error(`Embedding API failed: ${await response.text()}`);
  const data = await response.json();
  return data?.embedding?.values || [];
}

async function semanticRetrieve(jobDescription, candidates) {
  const queryEmbedding = await embedText(jobDescription, "RETRIEVAL_QUERY");
  const ranked = [];
  for (const candidate of candidates) {
    const chunks = chunkText(candidate.extractedText || "");
    if (!chunks.length) continue;
    const chunkScores = [];
    for (const chunk of chunks) {
      const embedding = await embedText(chunk, "RETRIEVAL_DOCUMENT");
      chunkScores.push({ chunk, score: cosineSimilarity(queryEmbedding, embedding) });
    }
    chunkScores.sort((a, b) => b.score - a.score);
    ranked.push({ candidate, semanticScore: Math.round((chunkScores[0]?.score || 0) * 100), ragContext: chunkScores.slice(0, 3).map(x => x.chunk) });
  }
  return ranked.sort((a, b) => b.semanticScore - a.semanticScore);
}

async function analyzeTopCandidate(candidate, jobDescription, ragContext) {
  const genAI = getGeminiClient();
  if (!genAI) throw new Error("Gemini API key is missing. Set GEMINI_API_KEY in backend/.env.");
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-2.0-flash" });
  const prompt = `
You are the final candidate-analysis layer of a resume screening pipeline.
Do NOT invent facts. Analyze only the job description, candidate resume, and retrieved resume evidence.

Return ONLY valid JSON:
{"ai_score":0,"summary":"","strengths":[],"missing_skills":[],"experience_match":"","project_relevance":"","reasoning":""}

Job Description:
${jobDescription}

Candidate Resume:
${candidate.extractedText}

Retrieved Evidence (RAG context):
${ragContext.join("\n\n---\n\n")}
`;
  const result = await model.generateContent(prompt);
  return safeJsonParse(result.response.text());
}

function getShortlistFilter(value) {
  if (value === undefined || value === null || value === "" || value === "all") return null;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true","1","selected","shortlisted","yes"].includes(normalized)) return true;
  if (["false","0","not-selected","rejected","no"].includes(normalized)) return false;
  return null;
}
async function extractResumeTextFromStoredFile(filename) {
  if (!filename) return "";
  const filePath = path.join(process.cwd(), "uploads", filename);
  if (!fs.existsSync(filePath)) return "";
  try { const { text } = await pdfParse(fs.readFileSync(filePath)); return text || ""; } catch { return ""; }
}

export const uploadResumes = async (req, res) => {
  try {
    const { jobId } = req.body;
    const files = req.files || [];
    if (!jobId) return res.status(400).json({ message: "jobId is required" });
    if (!files.length) return res.status(400).json({ message: "No files provided" });
    const job = await Job.findOne({ userId: req.user.id, jobId });
    if (!job) return res.status(404).json({ message: "Job not found for this user. Please create a job first." });

    const results = [];
    for (const file of files) {
      try {
        const filePath = path.join(process.cwd(), "uploads", file.filename);
        const { text: resumeText } = await pdfParse(fs.readFileSync(filePath));
        const skills = extractSkills(resumeText);
        const details = extractResumeDetails(resumeText);
        const { score, matchedKeywords } = keywordScore(job.description, resumeText, skills);
        const candidate = await Candidate.create({
          userId: req.user.id, jobId, name: firstUsefulLine(resumeText), email: extractEmail(resumeText),
          phone: extractPhone(resumeText), score, keywordScore: score, matchedKeywords, skills,
          extractedText: resumeText, extractedDetails: details,
          summary: "Resume parsed successfully. Candidate will be semantically screened against the job description.",
          resumeFile: file.filename, missingSkills: [], rejectionReason: ""
        });
        results.push({ filename: file.filename, candidateId: candidate._id, name: candidate.name || "Unknown", keywordScore: score, status: "success" });
      } catch (fileError) {
        results.push({ filename: file.filename, status: "failed", reason: fileError.message });
      }
    }
    return res.json({ message: "Resumes parsed and stored. Keyword ranking is ready for screening.", processed: results.length, results });
  } catch (error) {
    return res.status(500).json({ message: "Failed to upload resumes", error: error.message });
  }
};

export const getAllCandidates = async (req, res) => {
  try {
    const { jobId } = req.params;
    const shortlistedFilter = getShortlistFilter(req.query.selected ?? req.query.shortlisted);
    const query = { userId: req.user.id, jobId };
    if (shortlistedFilter !== null) query.isShortlisted = shortlistedFilter;
    const candidates = await Candidate.find(query).sort({ keywordScore: -1, createdAt: -1 });
    return res.json(candidates);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch candidates", error: error.message });
  }
};

export const getTopCandidates = async (req, res) => {
  try {
    const { jobId } = req.query;
    const finalLimit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 20);
    const keywordLimit = 100;
    if (!jobId) return res.status(400).json({ message: "jobId query param is required" });

    const job = await Job.findOne({ userId: req.user.id, jobId });
    if (!job) return res.status(404).json({ message: "Job not found" });
    const allCandidates = await Candidate.find({ userId: req.user.id, jobId });

    const scored = allCandidates.map(candidate => {
      const { score, matchedKeywords } = keywordScore(job.description, candidate.extractedText || "", candidate.skills || []);
      candidate.keywordScore = score;
      candidate.matchedKeywords = matchedKeywords;
      return candidate;
    }).sort((a, b) => (b.keywordScore || 0) - (a.keywordScore || 0));

    const top100 = scored.slice(0, keywordLimit);
    const semantic = await semanticRetrieve(job.description, top100);
    const top20 = semantic.slice(0, finalLimit);
    const finalCandidates = [];

    for (const item of top20) {
      const ai = await analyzeTopCandidate(item.candidate, job.description, item.ragContext);
      item.candidate.semanticScore = item.semanticScore;
      item.candidate.ragContext = item.ragContext;
      item.candidate.score = Number(ai?.ai_score ?? Math.round(((item.candidate.keywordScore || 0) * 0.4) + (item.semanticScore * 0.6)));
      item.candidate.aiAnalysis = ai || { ai_score: item.candidate.score, summary: "Semantic screening completed; Gemini analysis was unavailable.", strengths: [], missing_skills: [], experience_match: "", project_relevance: "", reasoning: "" };
      item.candidate.summary = item.candidate.aiAnalysis.summary || item.candidate.summary;
      item.candidate.missingSkills = normalizeStringArray(item.candidate.aiAnalysis.missing_skills);
      await item.candidate.save();
      finalCandidates.push(item.candidate);
    }
    finalCandidates.sort((a, b) => (b.score || 0) - (a.score || 0));

    return res.json({
      pipeline: {
        totalCandidates: allCandidates.length,
        keywordStage: Math.min(allCandidates.length, keywordLimit),
        semanticStage: top20.length,
        finalStage: top20.length,
        description: "Keyword filtering → Top 100 → semantic RAG retrieval → Top 20 → Gemini scoring and analysis"
      },
      candidates: finalCandidates
    });
  } catch (error) {
    console.error("Screening pipeline error:", error);
    return res.status(500).json({ message: "Failed to run screening pipeline", error: error.message });
  }
};

export const getShortlistedCandidates = async (req, res) => {
  try {
    const { jobId } = req.params;
    const candidates = await Candidate.find({ userId: req.user.id, jobId, isShortlisted: true }).sort({ score: -1, createdAt: -1 });
    return res.json({ candidates });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch shortlisted candidates", error: error.message });
  }
};

export const toggleCandidateSelection = async (req, res) => {
  try {
    const { candidateId } = req.params;
    const { isShortlisted, shortlistReason = "" } = req.body;
    if (typeof isShortlisted !== "boolean") return res.status(400).json({ message: "isShortlisted boolean is required" });
    const candidate = await Candidate.findOne({ _id: candidateId, userId: req.user.id });
    if (!candidate) return res.status(404).json({ message: "Candidate not found" });
    candidate.isShortlisted = isShortlisted;
    candidate.shortlistedAt = isShortlisted ? new Date() : null;
    candidate.shortlistReason = isShortlisted ? shortlistReason : "";
    await candidate.save();
    return res.json({ message: isShortlisted ? "Candidate selected successfully" : "Candidate unselected successfully", candidate });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update candidate selection", error: error.message });
  }
};

export const sendRejectionEmails = async (req, res) => {
  try {
    const { jobId, rejectedCandidates } = req.body;
    if (!jobId || !Array.isArray(rejectedCandidates)) return res.status(400).json({ message: "jobId and rejectedCandidates array are required" });
    const job = await Job.findOne({ userId: req.user.id, jobId });
    if (!job) return res.status(404).json({ message: "Job not found for this user" });

    const allCandidates = await Candidate.find({ userId: req.user.id, jobId });
    const rejectedIds = new Set(rejectedCandidates.map(c => c?.resumeId).filter(Boolean).map(String));
    const rejectedEmails = new Set(rejectedCandidates.map(c => c?.email).filter(Boolean).map(e => e.toLowerCase()));
    const shortlistedIds = allCandidates.filter(c => !rejectedIds.has(String(c._id)) && !rejectedEmails.has((c.email || "").toLowerCase())).map(c => c._id);

    await Candidate.updateMany({ userId: req.user.id, jobId }, { $set: { isShortlisted: false, shortlistedAt: null, shortlistReason: "" } });
    if (shortlistedIds.length) await Candidate.updateMany({ _id: { $in: shortlistedIds } }, { $set: { isShortlisted: true, shortlistedAt: new Date(), shortlistReason: "Selected during shortlist review" } });

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
    const rejected = allCandidates.filter(c => Boolean(c.email) && (rejectedIds.has(String(c._id)) || rejectedEmails.has((c.email || "").toLowerCase()));

    await Promise.all(rejected.map(candidate => transporter.sendMail({
      from: process.env.EMAIL_USER, to: candidate.email, subject: `Application Update for ${jobId}`,
      text: `Dear ${candidate.name || "Candidate"},

Thank you for applying. After reviewing your profile, we have decided not to move forward with your application for this role.

Reason: ${candidate.rejectionReason || "The profile did not align closely enough with the current role requirements."}

Areas to strengthen: ${(candidate.missingSkills || []).join(", ") || "core skills relevant to the role"}.

Best regards,
Recruitment Team`
    })));

    return res.json({ message: "Rejection emails sent successfully", rejectedCount: rejected.length, shortlistedCount: shortlistedIds.length });
  } catch (error) {
    return res.status(500).json({ message: "Failed to send rejection emails", error: error.message });
  }
};
