import Job from "../models/Job.js";

export const createJob = async (req, res) => {
  try {
    const { jobId, description } = req.body;
    if (!jobId || !description) {
      return res.status(400).json({ message: "Job ID and description are required" });
    }
    const job = await Job.create({ jobId, description });
    res.json({ message: "Job created successfully", job });
  } catch (error) {
    res.status(500).json({ message: "Failed to create job", error });
  }
};
