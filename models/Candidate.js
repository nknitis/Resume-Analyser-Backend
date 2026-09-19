import mongoose from "mongoose";

const candidateSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  jobId: { type: String, required: true },
  name: String,
  email: String,
  phone: String,
  score: Number,
  keywordScore: Number,
  semanticScore: Number,
  matchedKeywords: [String],
  skills: [String],
  summary: String,
  extractedText: String,
  extractedDetails: {
    education: String,
    experience: String,
    projects: String,
    certifications: String
  },
  ragContext: [String],
  aiAnalysis: mongoose.Schema.Types.Mixed,
  resumeFile: String,
  missingSkills: [String],
  rejectionReason: String,
  isShortlisted: { type: Boolean, default: false },
  shortlistedAt: Date,
  shortlistReason: String,
  createdAt: { type: Date, default: Date.now }
});

candidateSchema.index({ userId: 1, jobId: 1 });

export default mongoose.model("Candidate", candidateSchema);
