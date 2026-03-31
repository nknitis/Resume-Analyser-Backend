import express from "express";
import multer from "multer";
import { uploadResumes, getAllCandidates, getTopCandidates, getShortlistedCandidates, toggleCandidateSelection, sendRejectionEmails } from "../controllers/resumeController.js";
import protect from "../middleware/authMiddleware.js";

const upload = multer({ dest: "uploads/" });
const router = express.Router();

router.post("/upload", protect, upload.array("resumes"), uploadResumes);
router.get("/candidates/:jobId", protect, getAllCandidates);
router.get("/top-candidates", protect, getTopCandidates);
router.get("/shortlisted/:jobId", protect, getShortlistedCandidates);
router.patch("/candidates/:candidateId/selection", protect, toggleCandidateSelection);
router.post("/send-rejection-emails", protect, sendRejectionEmails);

export default router;
