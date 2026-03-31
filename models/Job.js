import mongoose from "mongoose";

const jobSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  jobId: { type: String, required: true },
  description: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

jobSchema.index({ userId: 1, jobId: 1 }, { unique: true });

export default mongoose.model("Job", jobSchema);
