import mongoose from "mongoose";

const candidateSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  jobId: { type: String, required: true },
  name: String,
  email: String,
  phone: String,
  score: Number,
  summary: String,
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
