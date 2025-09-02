import mongoose from "mongoose";

const jobSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("Job", jobSchema);
