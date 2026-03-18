# CSV Upload Requirements

This document describes the CSV format requirements for bulk uploading content to the dashboard application.

## Overview

The dashboard supports bulk upload of content through CSV, Excel (.xlsx), and JSON files. This document focuses on CSV format requirements for each content type.

## Supported Content Types

1. **Speaker** - Conference speakers and presenters
2. **Agenda** - Event schedule and sessions
3. **Exhibitors** - Event exhibitors and vendors
4. **Guest** - Event attendees and participants
5. **Services** - Available services and offerings
6. **Activities** - Excursions and activities
7. **Photos** - Photo albums and images
8. **IFrame Keywords** - Keywords for iframe content
9. **Event Map** - Event mapping and navigation
10. **Knowledge Keywords** - Knowledge base keywords

## CSV Format Guidelines

### General Rules
- Use comma-separated values (CSV)
- Include header row with field names
- Use quotes around text values containing commas
- Empty fields can be left blank
- Date/time fields should be in ISO 8601 format (e.g., `2024-01-15T10:00:00Z`)
- Boolean fields use `true`/`false` or `1`/`0`
- Array fields use comma-separated values within quotes

### Automatic Fields
The system automatically adds these fields to each record:
- `assistant_id` - Assistant identifier
- `tenantId` - Tenant identifier

## Content Type Requirements

### 1. Speaker

**Required Fields:**
- `name` - Speaker's full name
- `title` - Speaker's job title
- `company` - Speaker's company/organization
- `photo` - URL to speaker's photo

**Optional Fields:**
- `session` - Session name or topic
- `dayTime` - Date and time of presentation (ISO 8601 format)
- `bio` - Speaker biography
- `categories` - Comma-separated list of categories

**Example CSV:**
```csv
name,title,company,photo,session,dayTime,bio,categories
"Dr. John Smith","AI Research Director","Tech Corp","https://example.com/john.jpg","AI in 2024","2024-01-15T10:00:00Z","Leading AI researcher with 15 years experience","AI,Research,Technology"
"Sarah Johnson","Senior Developer","StartupXYZ","https://example.com/sarah.jpg","Machine Learning","2024-01-15T14:00:00Z","Expert in machine learning applications","ML,Development"
```

### 2. Agenda

**Required Fields:**
- `track` - Session track name
- `title` - Session title
- `speaker` - Speaker name

**Optional Fields:**
- `dayTime` - Date and time of session (ISO 8601 format)
- `description` - Session description
- `location` - Session location
- `categories` - Comma-separated list of categories
- `type` - Session type
- `tellMeMore` - Additional information

**Example CSV:**
```csv
track,title,speaker,dayTime,description,location,categories,type
"Main Track","AI in 2024","Dr. John Smith","2024-01-15T10:00:00Z","Discussion about AI trends","Main Hall","AI,Tech","session"
"Workshop","Hands-on ML","Sarah Johnson","2024-01-15T14:00:00Z","Interactive machine learning workshop","Room 101","ML,Workshop","workshop"
```

### 3. Exhibitors

**Required Fields:**
- `title` - Exhibitor name/title
- `location` - Booth location
- `tellMeMore` - URL to more information

**Optional Fields:**
- `category` - Exhibitor category
- `description` - Exhibitor description
- `logo` - URL to exhibitor logo
- `exTags` - Comma-separated list of tags (max 5)

**Example CSV:**
```csv
title,location,category,description,logo,tellMeMore,exTags
"Tech Expo","Hall A","Technology","Latest tech innovations","https://example.com/logo.jpg","https://example.com/more","Tech,Innovation"
"Startup Showcase","Hall B","Startups","Emerging companies","https://example.com/startup.jpg","https://example.com/startup","Startup,Innovation"
```

### 4. Guest

**Required Fields:**
- `name` - Guest's full name
- `phone_number` - Contact phone number
- `passPhrase` - Access passphrase

**Optional Fields:**
- `interests` - Comma-separated list of interests
- `messages` - Messages (JSON array format)
- `eventHistory` - Event history (JSON array format)
- `chatHistory` - Chat history (JSON array format)

**Example CSV:**
```csv
name,phone_number,passPhrase,interests
"John Doe","1234567890","testpass123","AI,Technology,Innovation"
"Jane Smith","0987654321","janepass456","Business,Leadership,Networking"
```

### 5. Services

**Required Fields:**
- `item_name` - Service name
- `price` - Service price (numeric)
- `photo_url` - URL to service image
- `description` - Service description
- `category` - Service category

**Optional Fields:**
- `available` - Availability status (true/false)
- `prep_time_minutes` - Preparation time in minutes
- `client_code` - Client identifier
- `duration` - Service duration
- `customFields` - Custom fields (JSON format)

**Example CSV:**
```csv
item_name,price,photo_url,description,category,available,prep_time_minutes,client_code
"Premium Service",99.99,"https://example.com/service.jpg","High-quality premium service","Premium","true",30,"CLIENT001"
"Basic Package",49.99,"https://example.com/basic.jpg","Standard service package","Standard","true",15,"CLIENT001"
```

### 6. Activities

**Required Fields:**
- `excursion_name` - Activity/excursion name
- `time` - Activity time (ISO 8601 format)
- `description` - Activity description
- `location` - Activity location
- `photo_url` - URL to activity image
- `category` - Activity category

**Optional Fields:**
- `is_active` - Activity status (true/false)
- `client_code` - Client identifier

**Example CSV:**
```csv
excursion_name,time,description,location,photo_url,category,is_active,client_code
"City Tour","2024-01-15T14:00:00Z","Explore the city highlights","Downtown","https://example.com/tour.jpg","Sightseeing","true","CLIENT001"
"Adventure Hike","2024-01-16T09:00:00Z","Mountain hiking adventure","Mountain Trail","https://example.com/hike.jpg","Adventure","true","CLIENT001"
```

### 7. Photos

**⚠️ Special Note:** Photo uploads work differently from other content types. Photos are uploaded as image files rather than CSV data.

**Photo Upload Process:**
1. **File Upload**: Upload actual image files (JPG, PNG, GIF, WEBP)
2. **Album Organization**: Images are organized into albums
3. **S3 Storage**: Images are stored in AWS S3 with organized folder structure
4. **Database Records**: Photo metadata is stored in the database

**Supported Image Formats:**
- JPEG (.jpg, .jpeg)
- PNG (.png)
- GIF (.gif)
- WebP (.webp)

**File Size Limits:**
- Maximum batch size: 100 images per upload
- Individual file size limit: Not explicitly set (uses S3 limits)

**Required Information:**
- **Album Name**: Required for organizing photos
- **Image Files**: At least one image file must be selected

**S3 Storage Structure:**
```
{assistant-subdomain}/photos/{album-name}/{filename}
```

**Example Upload Flow:**
1. Select "Photos" content type
2. Enter album name (e.g., "Event Photos")
3. Upload image files (drag & drop or file picker)
4. Images are uploaded to S3 and organized by album
5. Photo records are created in the database

**Alternative: CSV Upload for Photo URLs**
If you have existing photo URLs, you can use CSV format:

**Required Fields:**
- `url` - Photo URL (must be valid HTTP/HTTPS URL)
- `album` - Album name

**Optional Fields:**
- `description` - Photo description
- `tags` - Comma-separated list of tags

**Example CSV for Photo URLs:**
```csv
url,album,description,tags
"https://example.com/photo1.jpg","Event Photos","Opening ceremony","Event,Opening"
"https://example.com/photo2.jpg","Event Photos","Keynote speaker","Event,Speaker"
```

### 8. IFrame Keywords

**Required Fields:**
- `name` - Keyword name
- `url` - Iframe URL
- `keywords` - Comma-separated list of keywords

**Example CSV:**
```csv
name,url,keywords
"Map View","https://example.com/map","map,location,navigation"
"Live Feed","https://example.com/feed","live,stream,real-time"
```

### 9. Event Map

**Required Fields:**
- `eventName` - Event name
- `url` - Map URL

**Example CSV:**
```csv
eventName,url
"Main Conference","https://example.com/conference-map"
"Workshop Area","https://example.com/workshop-map"
```

### 10. Knowledge Keywords

**Required Fields:**
- `keyword` - Keyword term
- `description` - Keyword description

**Example CSV:**
```csv
keyword,description
"AI","Artificial Intelligence and machine learning concepts"
"Blockchain","Distributed ledger technology and applications"
```

## Data Validation

### Field Type Requirements

**Text Fields:**
- Must be non-empty strings for required fields
- Can contain any printable characters
- Use quotes for values containing commas

**Numeric Fields:**
- Must be valid numbers
- No currency symbols (use decimal numbers)

**Date/Time Fields:**
- Use ISO 8601 format: `YYYY-MM-DDTHH:MM:SSZ`
- Example: `2024-01-15T10:00:00Z`

**Boolean Fields:**
- Use `true`/`false` or `1`/`0`
- Case insensitive

**Array Fields:**
- Use comma-separated values within quotes
- Example: `"tag1,tag2,tag3"`

**URL Fields:**
- Must be valid HTTP/HTTPS URLs
- Include protocol (http:// or https://)

### Common Validation Errors

1. **Missing Required Fields** - All required fields must be present
2. **Invalid URLs** - Photo and URL fields must be valid URLs
3. **Invalid Dates** - Date fields must be in ISO 8601 format
4. **Invalid Numbers** - Price and numeric fields must be valid numbers
5. **Empty Required Fields** - Required fields cannot be empty

## Upload Process

### Data Upload (CSV/Excel/JSON)
1. **File Selection** - Choose CSV, Excel, or JSON file
2. **Content Type Selection** - Select the appropriate content type
3. **Data Preview** - Review parsed data before upload
4. **Validation** - System validates data against schemas
5. **Upload** - Data is uploaded to the database
6. **Confirmation** - Success/error messages displayed

### Photo Upload (Image Files)
1. **Content Type Selection** - Select "Photos" content type
2. **Album Name** - Enter album name for organization
3. **File Selection** - Upload image files (drag & drop or file picker)
4. **File Processing** - System processes and validates images
5. **S3 Upload** - Images uploaded to AWS S3 with organized structure
6. **Database Creation** - Photo records created in database
7. **Confirmation** - Success/error messages displayed

## Photo Upload Special Requirements

### Image File Requirements
- **Supported Formats**: JPEG, PNG, GIF, WebP
- **File Validation**: Must be valid image files
- **Batch Size**: Maximum 100 images per upload
- **Storage**: Images stored in AWS S3 with public access

### Album Organization
- **Album Name Required**: Must provide album name for photo organization
- **Folder Structure**: `{assistant-subdomain}/photos/{album-name}/{filename}`
- **Database Records**: Each photo gets a database record with URL and album info

### Upload Methods
1. **Direct File Upload**: Upload actual image files (recommended)
2. **CSV with URLs**: Upload CSV containing existing photo URLs
3. **ZIP Archive**: Upload ZIP file containing multiple images (extracted automatically)

### Special Features
- **Drag & Drop**: Support for drag and drop file uploads
- **File Processing**: Automatic extraction from ZIP archives
- **Progress Tracking**: Real-time upload progress display
- **Error Handling**: Detailed error messages for failed uploads
- **Duplicate Prevention**: System prevents duplicate photo records

## Tips for Successful Uploads

1. **Use the provided examples** as templates
2. **Validate your data** before uploading
3. **Check required fields** are present
4. **Use proper date formats** for date/time fields
5. **Test with small datasets** first
6. **Review the preview** before confirming upload
7. **Use quotes** for text containing commas
8. **Ensure URLs are accessible** and valid

## Error Handling

The system provides detailed error messages for:
- Missing required fields
- Invalid data types
- Schema validation failures
- File format issues
- Upload failures

Review error messages carefully and correct issues before re-uploading. 