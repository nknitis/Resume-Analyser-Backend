import mongoose from "mongoose";

const candidateSchema = new mongoose.Schema({
  jobId: { type: String, required: true },
  name: String,
  email: String,
  phone: String,
  score: Number,
  summary: String,
  resumeFile: String,
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("Candidate", candidateSchema);
