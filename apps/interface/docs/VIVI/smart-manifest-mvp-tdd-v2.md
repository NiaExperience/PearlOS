# Smart Manifest – MVP Technical Design Document

**Author(s)**: [Your Name]  
**Date Created**: [Today’s Date]  
**Status**: Draft  

---

## 1. Summary / TL;DR

This document outlines the technical design for Phase 1 MVP of Smart Manifest – Powered by ViVi. The MVP will support structured manifest ingestion, rule-based data validation, and user feedback through a basic UI. 

To meet budget and timeline constraints, this phase **excludes OCR**, limits third-party integration to **Google Maps**, and includes **initial integration with the VIP Portal** (pending discovery and coordination). The total timeline for delivery is **1 month**.

---

## 2. Problem Statement

drvn currently relies on manual processes to validate and interpret passenger manifests, which is time-consuming and error-prone. The goal of Smart Manifest is to streamline pre-service intake by automating file ingestion and validation, providing structured feedback to reduce friction and accelerate service proposal generation.

---

## 3. Goals and Non-Goals

### Goals
- Accept uploads of `.xlsx` and basic `.pdf` manifest files
- Extract structured tabular data from input files
- Apply rule-based validation to manifest contents
- Provide structured validation feedback and scoring
- Use **Google Maps API** to validate pickup and drop-off addresses
- Provide downloadable result files (JSON and CSV)
- Initial integration with MTC VIP Portal (pending timeline/discovery)

### Non-Goals (Out of Scope for MVP)
- OCR or scanned image processing
- FlightStats API or internal drvn API integrations
- Voice or chat interaction
- AI learning/memory or user-specific adaptation
- Full proposal generation logic
- Real-time feedback iteration loop (planned for future phases)
- Monitoring and observability dashboards

---

## 4. System Architecture

### Overview
The Smart Manifest MVP processes manifest files uploaded by users, applies validation rules, checks for location accuracy using Google Maps, and provides structured feedback. The system is modular and built to be extensible in future phases.

### Core Components

| Component           | Description |
|---------------------|-------------|
| **Upload Interface** | Web UI for users to upload `.xlsx` or `.pdf` files. |
| **Parser Service**  | Extracts tabular data from manifest files and normalizes it. |
| **Validation Engine** | Applies configurable rule sets to check format, data integrity, and completeness. Generates scores and flags errors. |
| **Address Validator** | Uses Google Maps API to confirm that pickup and dropoff locations are valid and logical. |
| **Feedback Renderer** | Displays structured errors, scores, and allows JSON/CSV result downloads. |
| **VIP Portal Bridge (Future-Safe)** | Placeholder interface for integrating results directly into MTC’s VIP Portal once discovery is complete. |

### Data Flow (High-Level)

1. **User Uploads File**  
2. ➡ **Parser Normalizes Input**  
3. ➡ **Validation Engine Applies Rules**  
4. ➡ **Google Maps API Validates Addresses**  
5. ➡ **Results Passed to Feedback Renderer**  
6. ➡ **User Reviews + Downloads Output**

### Tech Stack
- **Frontend**: Web-based UI
- **Backend**: Modular web service
- **External APIs**: Google Maps Geocoding API
- **Hosting**: Cloud-based or containerized deployment on client infrastructure
- **Security**: File type/size validation, sandboxed parsing, secure handling of uploaded files

### Future Considerations (Phase 2+)
- Add OCR for image-based PDFs
- Real-time chat/voice correction loop
- Deep integration with proposal generation logic
- Memory/learning of client preferences
- Full VIP Portal backend integration

---

## 5. Key Components

### File Parser
- Accepts `.xlsx` and `.pdf` (text-based only)
- Extracts tables and normalizes to a common format

### Validation Engine
- Minimum structure: 4 columns, 5 rows, 20 non-empty cells
- Data types and formatting rules (e.g., phone numbers, names)
- Column scoring (Completeness and Content Quality)
- Outlier detection (e.g., address anomalies)
- Configurable rule execution and feedback output in JSON and CSV
- **Initial rules and template definitions to be provided by Moveo; collaboration required to finalize MVP rule set**

### Address Validation
- Google Maps API:
  - Confirm existence of pickup/dropoff locations
  - Flag likely geographic outliers (e.g., wrong country/city)

### Feedback UI
- Table of parsed data
- Error/warning markers with inline messages
- Scoring widgets (bar/percentage)
- Options to download result files in JSON and CSV formats

---

## 6. MVP Rollout Plan

| Week | Focus Area | Deliverables |
|------|------------|--------------|
| **Week 1** | Kickoff & File Ingestion | Finalize scope, setup parsing for `.xlsx`/`.pdf` |
| **Week 2** | Validation Logic | Implement rule engine and Google Maps API checks |
| **Week 3** | Feedback UI | Score display, JSON/CSV export, error messages |
| **Week 4** | QA & Launch | MVP testing, final tweaks, walkthrough demo |

---

## 7. Open Questions
- How will Moveo provide and approve the initial validation rules and templates?
- Are multiple manifest formats supported in MVP?
- Will downloadable corrections be used or must edits be in-UI?
- What constraints or blockers exist for VIP Portal integration timeline?

---

## 8. Appendix
- Moveo Requirements Summary
- Original NiaXP Proposal
- Google Maps API Reference
- Sample Manifest Templates
