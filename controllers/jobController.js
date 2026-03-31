import Job from "../models/Job.js";
import Candidate from "../models/Candidate.js";

export const createJob = async (req, res) => {
  try {
    const { jobId, description, jobDescription } = req.body;
    const finalDescription = (description || jobDescription || "").trim();

    if (!jobId || !finalDescription) {
      return res.status(400).json({ message: "Job ID and description are required" });
    }

    const existing = await Job.findOne({ userId: req.user.id, jobId });
    if (existing) {
      return res.status(409).json({ message: "Job ID already exists for this user" });
    }

    const job = await Job.create({ userId: req.user.id, jobId, description: finalDescription });
    return res.status(201).json({ message: "Job created successfully", job });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create job", error: error.message });
  }
};

export const getUserJobs = async (req, res) => {
  try {
    const { userId } = req.params;

    if (String(userId) !== String(req.user.id)) {
      return res.status(403).json({ message: "You can only view your own jobs" });
    }

    const jobs = await Job.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();

    const jobsWithCounts = await Promise.all(
      jobs.map(async (job) => {
        const shortlistedCount = await Candidate.countDocuments({
          userId: req.user.id,
          jobId: job.jobId,
          isShortlisted: true
        });

        return {
          ...job,
          id: job._id,
          jobDescription: job.description,
          shortlistedCount
        };
      })
    );

    return res.json({ jobs: jobsWithCounts });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch jobs", error: error.message });
  }
};

export const getShortlistedCandidatesByJob = async (req, res) => {
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
