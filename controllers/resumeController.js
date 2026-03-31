import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Candidate from "../models/Candidate.js";
import Job from "../models/Job.js";
import nodemailer from "nodemailer";

function getGeminiClient() {
  const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GEMINI;
  return geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;
}

function getFriendlyGeminiError(message = "") {
  if (message.includes("API_KEY_INVALID")) {
    return "Gemini API key is invalid. Update GEMINI_API_KEY in backend/.env and restart the backend server.";
  }

  if (
    message.includes("is not found for API version") ||
    message.includes("not supported for generateContent")
  ) {
    return "Configured Gemini model is unavailable. Set GEMINI_MODEL=gemini-2.0-flash (or another supported model) in backend/.env and restart the backend server.";
  }

  if (
    message.includes("429 Too Many Requests") ||
    message.includes("Quota exceeded") ||
    message.includes("quota")
  ) {
    return "Gemini quota exceeded for the configured API key/project. This is usually a Google AI Studio or billing/quota issue, not a resume parsing bug. Check the active API key, project quota, and billing, then restart the backend if you update backend/.env.";
  }

  return message;
}

function getShortlistFilter(value) {
  if (value === undefined || value === null || value === "" || value === "all") {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "selected", "shortlisted", "yes"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "not-selected", "rejected", "no"].includes(normalized)) {
    return false;
  }

  return null;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cleanModelJson(text = "") {
  return text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim()
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]");
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

function extractPotentialSkills(jobDescription = "") {
  const matches = jobDescription.match(/[A-Za-z][A-Za-z0-9+.#/-]{1,}/g) || [];
  const stopWords = new Set([
    "the", "and", "for", "with", "from", "that", "this", "have", "will", "your",
    "you", "our", "are", "job", "role", "team", "years", "year", "work", "good",
    "strong", "skills", "skill", "experience", "candidate", "required", "preferred"
  ]);

  return [...new Set(
    matches
      .map((item) => item.trim())
      .filter((item) => item.length > 2)
      .filter((item) => !stopWords.has(item.toLowerCase()))
  )].slice(0, 10);
}

function buildFallbackRejectionFeedback(candidate, jobDescription) {
  const missingSkills = extractPotentialSkills(jobDescription).slice(0, 4);
  const score = Number(candidate?.score ?? 0);
  const summary = (candidate?.summary || "").trim();

  let rejectionReason = "Your profile did not align closely enough with the role requirements for this round.";

  if (score > 0 && score < 50) {
    rejectionReason = "Your profile showed some relevant background, but the overall match with the role requirements was limited.";
  } else if (score >= 50 && score < 75) {
    rejectionReason = "Your application was relevant, but other candidates showed a closer match to the current role needs.";
  } else if (summary) {
    rejectionReason = `Your profile was considered carefully, but we needed stronger alignment with the role focus areas. ${summary}`;
  }

  return {
    missingSkills,
    rejectionReason,
  };
}

async function extractResumeTextFromStoredFile(filename) {
  if (!filename) {
    return "";
  }

  const filePath = path.join(process.cwd(), "uploads", filename);
  if (!fs.existsSync(filePath)) {
    return "";
  }

  try {
    const dataBuffer = fs.readFileSync(filePath);
    const { text } = await pdfParse(dataBuffer);
    return text || "";
  } catch {
    return "";
  }
}

async function analyzeResume(resumeText, jobDescription) {
  const genAI = getGeminiClient();
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";

  if (!genAI) {
    throw new Error("Gemini API key is missing. Set GEMINI_API_KEY in backend/.env.");
  }

  const model = genAI.getGenerativeModel({ model: modelName });

  const prompt = `
  You are a resume screening assistant.
  Return valid JSON with:
  - name
  - email
  - phone
  - match_score (0-100 based on job description: ${jobDescription})
  - summary (2 lines max)
  - missing_skills (array of up to 5 important missing skills)
  - rejection_reason (1-2 sentences explaining why the profile may not be shortlisted)

  Resume:
  ${resumeText}
  `;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const cleanText = cleanModelJson(text);
  return safeJsonParse(cleanText);
}

async function generateRejectionFeedback(candidate, jobDescription, resumeText = "") {
  const fallback = buildFallbackRejectionFeedback(candidate, jobDescription);
  const genAI = getGeminiClient();

  if (!genAI) {
    return fallback;
  }

  try {
    const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    const model = genAI.getGenerativeModel({ model: modelName });
    const prompt = `
    You are helping write a respectful job rejection note.
    Based on the job description and candidate details, return only valid JSON with:
    - rejection_reason: 1 or 2 polite sentences
    - missing_skills: array of up to 4 specific missing or weaker skills/tools

    Job description:
    ${jobDescription}

    Candidate summary:
    Name: ${candidate?.name || ""}
    Score: ${candidate?.score || 0}
    Existing summary: ${candidate?.summary || ""}
    Resume text:
    ${resumeText || "Resume text unavailable"}
    `;

    const result = await model.generateContent(prompt);
    const parsed = safeJsonParse(cleanModelJson(result.response.text()));

    if (!parsed) {
      return fallback;
    }

    return {
      rejectionReason: String(parsed.rejection_reason || fallback.rejectionReason).trim(),
      missingSkills: normalizeStringArray(parsed.missing_skills).length
        ? normalizeStringArray(parsed.missing_skills)
        : fallback.missingSkills,
    };
  } catch {
    return fallback;
  }
}

export const uploadResumes = async (req, res) => {
  try {
    const { jobId } = req.body;
    const files = req.files || [];

    console.log("Upload request received - jobId:", jobId, "files:", files.length);

    if (!jobId) {
      return res.status(400).json({ message: "jobId is required" });
    }

    if (files.length === 0) {
      return res.status(400).json({ message: "No files provided" });
    }

    const job = await Job.findOne({ userId: req.user.id, jobId });
    if (!job) {
      return res.status(404).json({ message: "Job not found for this user. Please create a job first." });
    }

    const results = [];
    for (const file of files) {
      try {
        const filePath = path.join(process.cwd(), "uploads", file.filename);

        if (!fs.existsSync(filePath)) {
          console.log("File not found:", filePath);
          continue;
        }

        const dataBuffer = fs.readFileSync(filePath);
        const { text: resumeText } = await pdfParse(dataBuffer);
        const analysis = await analyzeResume(resumeText, job.description);

        if (analysis) {
          const candidate = await Candidate.create({
            userId: req.user.id,
            jobId,
            name: analysis.name || "",
            email: analysis.email || "",
            phone: analysis.phone || "",
            score: analysis.match_score || 0,
            summary: Array.isArray(analysis.summary) ? "" : (analysis.summary || ""),
            resumeFile: file.filename,
            missingSkills: normalizeStringArray(analysis.missing_skills),
            rejectionReason: analysis.rejection_reason || ""
          });
          results.push({
            filename: file.filename,
            name: analysis.name || "Unknown",
            score: analysis.match_score || 0,
            status: "success"
          });
        } else {
          results.push({
            filename: file.filename,
            status: "failed",
            reason: "Unable to analyze resume"
          });
        }
      } catch (fileError) {
        const friendlyReason = getFriendlyGeminiError(fileError.message);

        console.error("Error processing file:", file.filename, fileError.message);
        results.push({
          filename: file.filename,
          status: "failed",
          reason: friendlyReason
        });
      }
    }

    return res.json({ 
      message: "Resumes processed", 
      processed: results.length,
      results: results
    });
  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ message: "Failed to upload resumes", error: error.message });
  }
};

export const getAllCandidates = async (req, res) => {
  try {
    const { jobId } = req.params;
    const shortlistedFilter = getShortlistFilter(req.query.selected ?? req.query.shortlisted);
    const query = { userId: req.user.id, jobId };

    if (shortlistedFilter !== null) {
      query.isShortlisted = shortlistedFilter;
    }

    const candidates = await Candidate.find(query).sort({ score: -1, createdAt: -1 });
    return res.json(candidates);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch candidates", error: error.message });
  }
};

export const getTopCandidates = async (req, res) => {
  try {
    const { jobId, limit = 5 } = req.query;
    const shortlistedFilter = getShortlistFilter(req.query.selected ?? req.query.shortlisted);

    if (!jobId) {
      return res.status(400).json({ message: "jobId query param is required" });
    }

    const query = { userId: req.user.id, jobId };
    if (shortlistedFilter !== null) {
      query.isShortlisted = shortlistedFilter;
    }

    const candidates = await Candidate.find(query)
      .sort({ score: -1 })
      .limit(Number(limit));

    return res.json(candidates);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch top candidates", error: error.message });
  }
};

export const getShortlistedCandidates = async (req, res) => {
  try {
    const { jobId } = req.params;

    const candidates = await Candidate.find({
      userId: req.user.id,
      jobId,
      isShortlisted: true
    }).sort({ score: -1, createdAt: -1 });

    return res.json({ candidates });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch shortlisted candidates", error: error.message });
  }
};

export const toggleCandidateSelection = async (req, res) => {
  try {
    const { candidateId } = req.params;
    const { isShortlisted, shortlistReason = "" } = req.body;

    if (typeof isShortlisted !== "boolean") {
      return res.status(400).json({ message: "isShortlisted boolean is required" });
    }

    const candidate = await Candidate.findOne({
      _id: candidateId,
      userId: req.user.id
    });

    if (!candidate) {
      return res.status(404).json({ message: "Candidate not found" });
    }

    candidate.isShortlisted = isShortlisted;
    candidate.shortlistedAt = isShortlisted ? new Date() : null;
    candidate.shortlistReason = isShortlisted ? shortlistReason : "";

    await candidate.save();

    return res.json({
      message: isShortlisted ? "Candidate selected successfully" : "Candidate unselected successfully",
      candidate
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update candidate selection", error: error.message });
  }
};

export const sendRejectionEmails = async (req, res) => {
  try {
    const { jobId, rejectedCandidates } = req.body;

    if (!jobId || !Array.isArray(rejectedCandidates)) {
      return res.status(400).json({ message: "jobId and rejectedCandidates array are required" });
    }

    const job = await Job.findOne({ userId: req.user.id, jobId });
    if (!job) {
      return res.status(404).json({ message: "Job not found for this user" });
    }

    const allCandidates = await Candidate.find({ userId: req.user.id, jobId });
    const rejectedResumeIds = new Set(
      rejectedCandidates
        .map((candidate) => candidate?.resumeId)
        .filter(Boolean)
        .map((id) => String(id))
    );
    const rejectedEmails = new Set(
      rejectedCandidates
        .map((candidate) => candidate?.email)
        .filter(Boolean)
        .map((email) => email.toLowerCase())
    );

    const shortlistedCandidateIds = allCandidates
      .filter((candidate) => {
        const candidateId = String(candidate._id);
        const candidateEmail = (candidate.email || "").toLowerCase();

        return !rejectedResumeIds.has(candidateId) && !rejectedEmails.has(candidateEmail);
      })
      .map((candidate) => candidate._id);

    await Candidate.updateMany(
      { userId: req.user.id, jobId },
      {
        $set: {
          isShortlisted: false,
          shortlistedAt: null,
          shortlistReason: ""
        }
      }
    );

    if (shortlistedCandidateIds.length > 0) {
      await Candidate.updateMany(
        { _id: { $in: shortlistedCandidateIds } },
        {
          $set: {
            isShortlisted: true,
            shortlistedAt: new Date(),
            shortlistReason: "Selected during shortlist review"
          }
        }
      );
    }

    // Configure nodemailer transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail', // or your email service
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const emailableRejectedCandidates = allCandidates.filter((candidate) => {
      const candidateId = String(candidate._id);
      const candidateEmail = (candidate.email || "").toLowerCase();

      return (
        Boolean(candidate.email) &&
        (rejectedResumeIds.has(candidateId) || rejectedEmails.has(candidateEmail))
      );
    });

    const emailPromises = emailableRejectedCandidates.map(async (candidate) => {
      let rejectionReason = candidate.rejectionReason || "";
      let missingSkills = normalizeStringArray(candidate.missingSkills);

      if (!rejectionReason || missingSkills.length === 0) {
        const resumeText = await extractResumeTextFromStoredFile(candidate.resumeFile);
        const feedback = await generateRejectionFeedback(candidate, job.description, resumeText);
        rejectionReason = feedback.rejectionReason;
        missingSkills = feedback.missingSkills;

        await Candidate.updateOne(
          { _id: candidate._id },
          {
            $set: {
              rejectionReason,
              missingSkills,
            }
          }
        );
      }

      const missingSkillsLine = missingSkills.length
        ? `Areas to strengthen for similar roles: ${missingSkills.join(", ")}.`
        : "We encourage you to continue strengthening the core skills required for this role.";

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: candidate.email,
        subject: `Application Update for ${jobId}`,
        text: `Dear ${candidate.name || "Candidate"},\n\nThank you for applying for the position. After carefully reviewing your profile, we have decided not to move forward with your application for this role.\n\nReason: ${rejectionReason || "At this time, we needed a closer match with the current role requirements."}\n\n${missingSkillsLine}\n\nWe appreciate the time and effort you invested in your application, and we encourage you to apply again for future roles that match your profile.\n\nBest regards,\nRecruitment Team`,
      };

      return transporter.sendMail(mailOptions);
    });

    await Promise.all(emailPromises);

    return res.json({
      message: "Rejection emails sent successfully",
      rejectedCount: emailableRejectedCandidates.length,
      shortlistedCount: shortlistedCandidateIds.length
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to send rejection emails", error: error.message });
  }
};
