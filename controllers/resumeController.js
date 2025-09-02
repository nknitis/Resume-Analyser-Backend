// import fs from "fs";
// import path from "path";
// import pdfParse from "pdf-parse";
// import { GoogleGenerativeAI } from "@google/generative-ai";
// import Candidate from "../models/Candidate.js";
// import Job from "../models/Job.js";

// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// async function analyzeResume(resumeText, jobDescription) {
//   const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

//   const prompt = `
//   You are a resume screening assistant.
//   Return JSON with:
//   - name
//   - email
//   - phone
//   - match_score (0–100 based on job description: ${jobDescription})
//   - summary (2 lines max)

//   Resume:
//   ${resumeText}
//   `;

//   const result = await model.generateContent(prompt);
//   try {
//     const text = result.response.text();
//     return JSON.parse(text);
//   } catch {
//     return null;
//   }
// }

// // export const uploadResumes = async (req, res) => {
// //   try {
// //     const { jobId } = req.body;
// //     const files = req.files;

// //     const job = await Job.findOne({ jobId });
// //     if (!job) return res.status(404).json({ message: "Job ID not found" });

// //     for (const file of files) {
// //       const filePath = path.join(process.cwd(), "uploads", file.filename);

// //       const dataBuffer = fs.readFileSync(filePath);
// //       consol.log("buffer dine")
// //       const resumeText = await pdfParse(dataBuffer).then(data => data.text);

// //       const analysis = await analyzeResume(resumeText, job.description);

// //       if (analysis) {
// //         await Candidate.create({
// //           jobId,
// //           name: analysis.name,
// //           email: analysis.email,
// //           phone: analysis.phone,
// //           score: analysis.match_score,
// //           summary: analysis.summary,
// //           resumeFile: file.filename
// //         });
// //       }
// //     }

// //     res.json({ message: "Resumes analyzed and stored successfully" });
// //   } catch (error) {
// //     res.status(500).json({ message: "Failed to upload resumes", error });
// //   }
// // };

// export const getAllCandidates = async (req, res) => {
//   try {
//     const { jobId } = req.params;
//     const candidates = await Candidate.find({ jobId });
//     res.json(candidates);
//   } catch (error) {
//     res.status(500).json({ message: "Failed to fetch candidates", error });
//   }
// };

// export const getTopCandidates = async (req, res) => {
//   try {
//     const { jobId, limit = 5 } = req.query;
//     const candidates = await Candidate.find({ jobId })
//       .sort({ score: -1 })
//       .limit(Number(limit));
//     res.json(candidates);
//   } catch (error) {
//     res.status(500).json({ message: "Failed to fetch top candidates", error });
//   }
// };
// import fs from "fs";
// import path from "path";
// import pdf from "pdf-parse";
// import { GoogleGenerativeAI } from "@google/generative-ai";
// import Candidate from "../models/Candidate.js";
// import Job from "../models/Job.js";

// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// async function analyzeResume(resumeText, jobDescription) {
//   const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

//   const prompt = `
//   You are a resume screening assistant.
//   Return JSON with:
//   - name
//   - email
//   - phone
//   - match_score (0–100 based on job description: ${jobDescription})
//   - summary (2 lines max)

//   Resume:
//   ${resumeText}
//   `;

//   const result = await model.generateContent(prompt);
//   try {
//     const text = result.response.text();
//     return JSON.parse(text);
//   } catch (err) {
//     console.error("Gemini response parsing failed:", err);
//     return null;
//   }
// }

// export const uploadResumes = async (req, res) => {
//   try {
//     const { jobId } = req.body;
//     const files = req.files;
// console.log("get files")
//     // Check if job exists
//     const job = await Job.findOne({ jobId });
//     if (!job) return res.status(404).json({ message: "Job ID not found" });

//     for (const file of files) {
//       const filePath = path.join(process.cwd(), "uploads", file.filename);

//       // Prevent ENOENT crash
//       if (!fs.existsSync(filePath)) {
//         console.warn(`File not found: ${filePath}`);
//         continue; // skip this file instead of crashing
//       }

//       // Read file safely
//       const dataBuffer = fs.readFileSync(filePath);
//       console.log(`Processing file: ${file.filename}`);

//       const resumeText = await pdf(dataBuffer).then(data => data.text);
//       console.log('Extracted text length:', resumeText.text.length);
//       const analysis = await analyzeResume(resumeText, job.description);

//       if (analysis) {
//         await Candidate.create({
//           jobId,
//           name: analysis.name,
//           email: analysis.email,
//           phone: analysis.phone,
//           score: analysis.match_score,
//           summary: analysis.summary,
//           resumeFile: file.filename
//         });
//       }
//     }

//     res.json({ message: "Resumes analyzed and stored successfully" });
//   } catch (error) {
//     console.error("Error in uploadResumes:", error);
//     res.status(500).json({ message: "Failed to upload resumes", error });
//   }
// };/
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();
import path from "path";
import pdfParse from "pdf-parse";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Candidate from "../models/Candidate.js";
import Job from "../models/Job.js";

const genAI = new GoogleGenerativeAI(`${process.env.GEMINI}`);
console.log("ai")
async function analyzeResume(resumeText, jobDescription) {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `
  You are a resume screening assistant.
  Return JSON with:
  - name
  - email
  - phone
  - match_score (0–100 based on job description: ${jobDescription})
  - summary (2 lines max)

  Resume:
  ${resumeText}
  `;

  const result = await model.generateContent(prompt);
  try {
    const text = result.response.text();
    const cleanText=text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim()
    .replace(/,\s*}/g, '}');
    return JSON.parse(cleanText);
  } catch (err) {
    console.error("Gemini response parsing failed:", err);
     console.error("Raw Gemini response:", result.response.text());
    return null;
  }
}

export const uploadResumes = async (req, res) => {
  try {
    const { jobId } = req.body;
    const files = req.files;

    console.log("get files");

    // Check if job exists
    const job = await Job.findOne({ jobId });
    if (!job) return res.status(404).json({ message: "Job ID not found" });

    for (const file of files) {
      const filePath = path.join(process.cwd(), "uploads", file.filename);

      if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`);
        continue;
      }

      const dataBuffer = fs.readFileSync(filePath);
      console.log(`Processing file: ${file.filename}`);

      const { text: resumeText } = await pdfParse(dataBuffer);
      console.log('Extracted text length:', resumeText.length);

      const analysis = await analyzeResume(resumeText, job.description);

      if (analysis) {
        await Candidate.create({
          jobId,
          name: analysis.name||"",
          email: analysis.email||"",
          phone: analysis.phone||"",
          score: analysis.match_score||0,
          summary: Array.isArray(analysis.summary) ? "" : (analysis.summary || ""),
          resumeFile: file.filename
        });
      }
    }

    res.json({ message: "Resumes analyzed and stored successfully" });
  } catch (error) {
    console.error("Error in uploadResumes:", error);
    res.status(500).json({ message: "Failed to upload resumes", error });
  }
};




export const getAllCandidates = async (req, res) => {
  try {
    const { jobId } = req.params;
    const candidates = await Candidate.find({ jobId });
    res.json(candidates);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch candidates", error });
  }
};

export const getTopCandidates = async (req, res) => {
  try {
    const { jobId, limit = 5 } = req.query;
    const candidates = await Candidate.find({ jobId })
      .sort({ score: -1 })
      .limit(Number(limit));
    res.json(candidates);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch top candidates", error });
  }
};
