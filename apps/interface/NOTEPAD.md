# Notepad Feature

The Notepad feature provides users with a simple, multi-mode note-taking interface within the Pearl Frontend application. It supports both personal and work notes, allowing users to create, edit, delete, and download their notes.

## Features

- **Personal & Work Modes:** Switch between personal and work notes for better organization.
- **User Switching:** Demo/testing support for multiple users (e.g., "paddy", "nitesh", "himanshu").
- **CRUD Operations:** Create, read, update, and delete notes.
- **Download Notes:** Export individual notes as JSON files.
- **Permissions:** Notes are user-specific; work notes may have organization-based access control.
- **UI Integration:** Access the Notepad from the desktop-like interface (look for the Notepad icon).

## Multi-Tenant & Debug Mode

- The app is designed for multi-tenant scenarios, where users from different organizations should not see each other's work notes.
- For testing, we use a debug user switcher because full multi-tenant authentication is not yet implemented.
- If a user tries to access a note from a different organization, they will receive a permission error.

## PostgreSQL Tables

The following tables are used to support the Notepad feature:

- `users`: Stores user and organization information.
- `notes`: Stores personal notes.
- `work_notes`: Stores work notes, including organization and user references.

### Example Table Data

# PostgreSQL Database Overview using pgAdmin 4

This document provides an overview of a PostgreSQL database named `testdb`, as explored using pgAdmin 4. It includes information about the schema, tables, and data contained within key tables.

---

## 📁 Database Structure

###  Database Schema and Tables

![Database Schema]

- The connected database is `testdb`.
- Under the `public` schema, there are 4 tables:
  - `notes`
  - `notion_blocks`
  - `users`
  - `work_notes`


---

## 👤 Users Table

###  `users` Table Data

![Users Table]

- **Query Executed:** `SELECT * FROM users;`
- The table contains 3 users:
  - `paddy` (organization_id: NIA123)
  - `himanshu` (organization_id: NIA123)
  - `nitesh` (organization_id: ORG456)

---

## 📝 Notes Table

### `notes` Table Data

![Notes Table]

- **Query Executed:** `SELECT * FROM notes;`
- The table includes various notes with the following columns:
  - `title`, `content`, `created_at`, `updated_at`, `mode`, `user_id`, `organization_id`
- Example entries:
  - "Work Note 1" is a work note by `paddy` (NIA123)
  - "Nitesh Personal Note" is a personal note by `nitesh`

---

## 🛠️ Work Notes Table

### `work_notes` Table Data

![Work Notes Table]

- **Query Executed:** `SELECT * FROM work_notes;`
- This table contains notes specific to work mode.
- Contains one entry:
  - Title: "Bug Report 30July"
  - Content: "Testing WO Himanshu"
  - User: `himanshu`, Organization: `NIA123`

---

## 📌 Summary

- The database `testdb` is well-structured and contains organized tables for users, personal notes, and work notes.
- Users are associated with organizations via the `organization_id`.
- Notes are filtered by `mode` (`personal` or `work`) and linked to specific users and organizations.

This setup enables efficient role-based data filtering in applications based on user and organization context.

## Usage

1. **Accessing Notepad:**  
   Click the Notepad icon on the desktop interface to open the Notepad window.
2. **Creating a Note:**  
   Click the "+" button to create a new note. Enter a title and content.
3. **Editing a Note:**  
   Select a note from the list to view or edit. Changes are saved with the save button.
4. **Deleting a Note:**  
   Use the trash icon next to a note to delete it.
5. **Switching Modes:**  
   Toggle between "Personal" and "Work" modes to organize your notes.
6. **Downloading a Note:**  
   Use the download button to export the current note as a JSON file.

## Developer Notes

- The main logic is implemented in `src/components/notes-view.tsx`.
- Notes are fetched, created, updated, and deleted via API functions in `@interface/lib/notes-api`.
- The feature uses React state and hooks for UI and data management.
- Demo users are hardcoded for testing; integrate with your authentication system for production.
