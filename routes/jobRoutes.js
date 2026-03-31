import express from "express";
import { createJob, getShortlistedCandidatesByJob, getUserJobs } from "../controllers/jobController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/create", protect, createJob);
router.get("/user/:userId", protect, getUserJobs);
router.get("/:jobId/shortlisted", protect, getShortlistedCandidatesByJob);

export default router;
