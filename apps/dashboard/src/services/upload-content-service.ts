import * as XLSX from 'xlsx';
import * as Papa from "papaparse";
import JSZip from "jszip";
import { contentConfig, ValidationResult, UploadProgress, UploadResults } from "@dashboard/config/upload-content-config";

// Ensure FileList is available (DOM type)
declare global {
  interface FileList extends ArrayLike<File> {
    readonly length: number;
    item(index: number): File | null;
    [index: number]: File;
  }
}

// Type definitions for API responses
interface PresignedUrlResponse {
  url: string;
}

interface BulkPresignedUrlResponse {
  urls: string[];
  successCount: number;
  failureCount: number;
  failures: string[];
}

interface UploadResult {
  insertedCount?: number;
}

// Additional business logic functions for the main component
export const createS3UploadHelpers = (
  selectedType: string | null,
  albumName: string,
  assistantSubdomain: string,
  setUploadProgress: (updater: (prev: UploadProgress) => UploadProgress) => void
) => {
  const sanitizeFileName = (name: string) => {
    return name.replace(/[^a-zA-Z0-9.-]/g, '_');
  };

  const uploadImagesToS3Bulk = async (images: File[]) => {
    const results = { successful: [] as string[], failed: [] as string[] };
    
    const fileMetadata = images.map(file => {
      const sanitizedFileName = sanitizeFileName(file.name);
      let preservedFilename: string;
      
      if (selectedType === 'photos') {
        const sanitizedAlbumName = sanitizeFileName(albumName || 'default-album');
        preservedFilename = `${assistantSubdomain}/photos/${sanitizedAlbumName}/${sanitizedFileName}`;
      } else {
        preservedFilename = `${assistantSubdomain}/${selectedType}/${sanitizedFileName}`;
      }

      return { file, filename: preservedFilename, sanitizedName: sanitizedFileName };
    });

    setUploadProgress(prev => ({ ...prev, currentItem: 'Getting presigned URLs...' }));

    try {
      const presignedResponse = await fetch('/api/bulk-upload-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: fileMetadata.map(meta => ({
            filename: meta.filename,
            fileType: meta.file.type
          }))
        })
      });

      if (!presignedResponse.ok) {
        console.log('Bulk upload endpoint not available, using individual requests...');
        return await uploadImagesToS3Individual(images, assistantSubdomain, selectedType, albumName, setUploadProgress);
      }

      const { urls, successCount, failureCount, failures } = await presignedResponse.json() as BulkPresignedUrlResponse;
      
      if (failureCount > 0) {
        console.warn(`⚠️ ${failureCount} presigned URLs failed to generate:`, failures);
        if (successCount === 0) {
          throw new Error(`All ${failureCount} presigned URL requests failed`);
        }
      }
      
      setUploadProgress(prev => ({ ...prev, currentItem: `Uploading ${images.length} files in parallel...` }));

      const filesToUpload = successCount && successCount < fileMetadata.length 
        ? fileMetadata.slice(0, successCount) 
        : fileMetadata;

      const uploadPromises = filesToUpload.map(async (meta, index) => {
        try {
          const presignedUrl = urls[index];
          if (!presignedUrl) throw new Error('No presigned URL available for this file');
          
          const uploadResponse = await fetch(presignedUrl as string, {
            method: 'PUT',
            body: meta.file,
            headers: { 'Content-Type': meta.file.type }
          });

          if (!uploadResponse.ok) throw new Error(`Upload failed: ${uploadResponse.statusText}`);

          const bucketName = process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME!;
          const region = process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1';
          const publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${meta.filename}`;

          return { success: true, url: publicUrl, filename: meta.file.name };
        } catch (error) {
          console.error(`❌ Failed to upload ${meta.file.name}:`, error);
          return { success: false, filename: meta.file.name, error };
        }
      });

      const uploadResults = await Promise.all(uploadPromises);
      
      uploadResults.forEach(result => {
        if (result.success && result.url) {
          results.successful.push(result.url);
        } else {
          results.failed.push(result.filename);
        }
      });

      setUploadProgress(prev => ({
        ...prev,
        current: images.length,
        currentItem: `Upload complete! ${results.successful.length}/${images.length} successful`
      }));

    } catch (error) {
      console.error('Batch upload failed, falling back to individual uploads:', error);
      return await uploadImagesToS3Individual(images, assistantSubdomain, selectedType, albumName, setUploadProgress);
    }

    return results;
  };

  return { uploadImagesToS3Bulk, sanitizeFileName };
};

// File processing functions
export const processZipFile = async (zipFile: File): Promise<File[]> => {
  const imageFiles: File[] = [];
  
  const zip = new JSZip();
  const zipContent = await zip.loadAsync(zipFile);
  
  const supportedImageTypes = /\.(jpg|jpeg|png|gif|webp)$/i;
  
  for (const filename in zipContent.files) {
    const fileData = zipContent.files[filename];
    
    // Skip directories
    if (fileData.dir) continue;
    
    // Check if it's a supported image type
    if (!supportedImageTypes.test(filename)) {
      console.log(`⏭️ Skipping unsupported file: ${filename}`);
      continue;
    }
    
    try {
      // Get the file data as blob
      const blob = await fileData.async('blob');
      
      // Determine MIME type based on file extension
      const extension = filename.toLowerCase().split('.').pop();
      let mimeType = 'image/jpeg'; // default
      
      switch (extension) {
        case 'png':
          mimeType = 'image/png';
          break;
        case 'gif':
          mimeType = 'image/gif';
          break;
        case 'webp':
          mimeType = 'image/webp';
          break;
        case 'jpg':
        case 'jpeg':
          mimeType = 'image/jpeg';
          break;
      }
      
      // Create a proper File object
      const file = new (globalThis as any).File([blob], filename, {
        type: mimeType,
        lastModified: Date.now()
      });
      
      imageFiles.push(file);
      console.log(`✅ Extracted: ${filename} (${(blob.size / 1024).toFixed(1)}KB)`);
      
    } catch (error) {
      console.error(`❌ Failed to extract ${filename}:`, error);
    }
  }
  
  console.log(`📦 ZIP processing complete: ${imageFiles.length} images extracted`);
  return imageFiles;
};

export const processImageFiles = async (files: FileList | File[]) => {
  const fileArray = Array.from(files);
  const processedFiles: File[] = [];
  
  for (const file of fileArray) {
    if (file.type.startsWith('image/')) {
      // Direct image file
      processedFiles.push(file);
    } else if (file.name.toLowerCase().endsWith('.zip')) {
      // ZIP file containing images
      try {
        console.log(`📦 Processing ZIP file: ${file.name}`);
        const extractedImages = await processZipFile(file);
        processedFiles.push(...extractedImages);
      } catch (error) {
        console.error(`❌ Failed to process ZIP file ${file.name}:`, error);
      }
    }
  }
  
  return processedFiles;
};

// S3 Upload Functions
export const uploadImagesToS3 = async (
  images: File[], 
  assistantSubdomain: string, 
  selectedType: string | null, 
  albumName: string,
  setUploadProgress: (updater: (prev: UploadProgress) => UploadProgress) => void
): Promise<UploadResults> => {
  const results = {
    successful: [] as string[],
    failed: [] as string[]
  };

  // Batch prepare all file metadata
  const sanitizeFileName = (name: string) => {
    return name.replace(/[^a-zA-Z0-9.-]/g, '_');
  };

  const fileMetadata = images.map(file => {
    const sanitizedFileName = sanitizeFileName(file.name);
    let preservedFilename: string;
    
    if (selectedType === 'photos') {
      const sanitizedAlbumName = sanitizeFileName(albumName || 'default-album');
      preservedFilename = `${assistantSubdomain}/photos/${sanitizedAlbumName}/${sanitizedFileName}`;
    } else {
      preservedFilename = `${assistantSubdomain}/${selectedType}/${sanitizedFileName}`;
    }

    return {
      file,
      filename: preservedFilename,
      sanitizedName: sanitizedFileName
    };
  });

  // Batch get all presigned URLs at once
  setUploadProgress(prev => ({
    ...prev,
    currentItem: 'Getting presigned URLs...'
  }));

  try {
    const presignedResponse = await fetch('/api/bulk-upload-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: fileMetadata.map(meta => ({
          filename: meta.filename,
          fileType: meta.file.type
        }))
      })
    });

    if (!presignedResponse.ok) {
      // Fallback to individual requests if bulk endpoint doesn't exist
      console.log('Bulk upload endpoint not available, using individual requests...');
      return await uploadImagesToS3Individual(images, assistantSubdomain, selectedType, albumName, setUploadProgress);
    }

    const { urls, successCount, failureCount, failures } = await presignedResponse.json() as BulkPresignedUrlResponse;
    
    // Handle partial failures
    if (failureCount > 0) {
      console.warn(`⚠️ ${failureCount} presigned URLs failed to generate:`, failures);
      // Filter out failed files from metadata to match successful URLs
      const successfulMetadata = fileMetadata.slice(0, successCount);
      
      if (successCount === 0) {
        throw new Error(`All ${failureCount} presigned URL requests failed`);
      }
      
      console.log(`📋 Proceeding with ${successCount} successful URLs out of ${fileMetadata.length} requested`);
    }
    
    // Parallel upload all files at once
    setUploadProgress(prev => ({
      ...prev,
      currentItem: `Uploading ${images.length} files in parallel...`
    }));

    // Only upload files that have valid presigned URLs
    const filesToUpload = successCount && successCount < fileMetadata.length 
      ? fileMetadata.slice(0, successCount) 
      : fileMetadata;

    const uploadPromises = filesToUpload.map(async (meta, index) => {
      try {
        const presignedUrl = urls[index];
        
        if (!presignedUrl) {
          throw new Error('No presigned URL available for this file');
        }
        
        // Upload to S3
        const uploadResponse = await fetch(presignedUrl as string, {
          method: 'PUT',
          body: meta.file,
          headers: { 
            'Content-Type': meta.file.type 
          }
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed: ${uploadResponse.statusText}`);
        }

        // Construct public URL
        const bucketName = process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME!;
        const region = process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1';
        const publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${meta.filename}`;

        return { success: true, url: publicUrl, filename: meta.file.name };
      } catch (error) {
        console.error(`❌ Failed to upload ${meta.file.name}:`, error);
        return { success: false, filename: meta.file.name, error };
      }
    });

    // Wait for all uploads to complete
    const uploadResults = await Promise.all(uploadPromises);
    
    // Process results
    uploadResults.forEach(result => {
      if (result.success && result.url) {
        results.successful.push(result.url);
        console.log(`✅ Successfully uploaded: ${result.filename}`);
      } else {
        results.failed.push(result.filename);
      }
    });

    setUploadProgress(prev => ({
      ...prev,
      current: images.length,
      currentItem: `Upload complete! ${results.successful.length}/${images.length} successful`
    }));

  } catch (error) {
    console.error('Batch upload failed, falling back to individual uploads:', error);
    return await uploadImagesToS3Individual(images, assistantSubdomain, selectedType, albumName, setUploadProgress);
  }

  return results;
};

// Fallback individual upload method (optimized)
export const uploadImagesToS3Individual = async (
  images: File[], 
  assistantSubdomain: string, 
  selectedType: string | null, 
  albumName: string,
  setUploadProgress: (updater: (prev: UploadProgress) => UploadProgress) => void
): Promise<UploadResults> => {
  const results = {
    successful: [] as string[],
    failed: [] as string[]
  };

  const sanitizeFileName = (name: string) => {
    return name.replace(/[^a-zA-Z0-9.-]/g, '_');
  };

  // Process uploads in parallel batches of 5 to avoid overwhelming the server
  const batchSize = 5;
  for (let i = 0; i < images.length; i += batchSize) {
    const batch = images.slice(i, i + batchSize);
    
    setUploadProgress(prev => ({
      ...prev,
      current: i,
      currentItem: `Uploading batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(images.length/batchSize)}...`
    }));

    const batchPromises = batch.map(async (file) => {
      try {
        const sanitizedFileName = sanitizeFileName(file.name);
        let preservedFilename: string;
        
        if (selectedType === 'photos') {
          const sanitizedAlbumName = sanitizeFileName(albumName || 'default-album');
          preservedFilename = `${assistantSubdomain}/photos/${sanitizedAlbumName}/${sanitizedFileName}`;
        } else {
          preservedFilename = `${assistantSubdomain}/${selectedType}/${sanitizedFileName}`;
        }

        // Get presigned URL
        const presignedResponse = await fetch('/api/s3-presigned-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            filename: preservedFilename, 
            fileType: file.type 
          })
        });

        if (!presignedResponse.ok) {
          throw new Error(`Failed to get presigned URL: ${presignedResponse.statusText}`);
        }

        const { url: presignedUrl } = await presignedResponse.json() as PresignedUrlResponse;

        // Upload to S3
        const uploadResponse = await fetch(presignedUrl, {
          method: 'PUT',
          body: file,
          headers: { 
            'Content-Type': file.type 
          }
        });

        if (!uploadResponse.ok) {
          throw new Error(`Failed to upload to S3: ${uploadResponse.statusText}`);
        }

        // Construct public URL
        const bucketName = process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME!;
        const region = process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1';
        const publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${preservedFilename}`;

        return { success: true, url: publicUrl, filename: file.name };
      } catch (error) {
        return { success: false, filename: file.name, error };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    
    batchResults.forEach(result => {
      if (result.success && result.url) {
        results.successful.push(result.url);
      } else if (!result.success && result.filename) {
        results.failed.push(result.filename);
      }
    });
  }

  setUploadProgress(prev => ({
    ...prev,
    current: images.length,
    currentItem: 'Upload complete!'
  }));

  return results;
};

// Image upload handler
export const handleImageUpload = async (
  uploadedImages: File[],
  albumName: string,
  assistantSubdomain: string,
  selectedType: string | null,
  assistantId: string,
  setIsImageUploading: (value: boolean) => void,
  setUploadProgress: (updater: (prev: UploadProgress) => UploadProgress) => void,
  toast: any
) => {
  if (uploadedImages.length === 0) {
    toast({
      title: "No Images Selected",
      description: "Please select at least one image to upload.",
      variant: "destructive",
    });
    return;
  }

  // Only require album name for photos content type
  if (selectedType === 'photos' && !albumName.trim()) {
    toast({
      title: "Album Name Required",
      description: "Please enter an album name for your photos.",
      variant: "destructive",
    });
    return;
  }

  setIsImageUploading(true);
  setUploadProgress(() => ({
    current: 0,
    total: uploadedImages.length,
    currentItem: 'Preparing upload...',
    completed: [],
    errors: []
  }));

  try {
    console.log(`🚀 Starting image upload process...`);
    console.log(`📁 Album: ${albumName}`);
    console.log(`🖼️ Images: ${uploadedImages.length}`);
    console.log(`👤 Assistant: ${assistantSubdomain}`);

    // Upload images to S3
    const results = await uploadImagesToS3(uploadedImages, assistantSubdomain, selectedType, albumName, setUploadProgress);

    console.log(`📊 Upload Results:`, results);

    if (results.successful.length === 0) {
      throw new Error('All image uploads failed');
    }

    // Handle database saving based on content type
    let databaseResult;
    let successMessage;

    if (selectedType === 'photos') {
      // Prepare photo data for database
      const photoJsonData = results.successful.map((url, index) => {
        // Extract album name from URL path for consistency
        const urlParts = url.split('/');
        const albumFromUrl = urlParts[urlParts.length - 2]; // Second to last part should be album
        
        return {
          url: url,
          album: albumFromUrl || albumName // Fallback to provided album name
        };
      });

      console.log(`💾 Saving ${photoJsonData.length} photos to database...`);

      // Save to database via photo album API
      const albumResponse = await fetch('/api/upload-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photos: photoJsonData,
          albumName: albumName,
          assistantId: assistantId
        })
      });

      if (!albumResponse.ok) {
        const errorText = await albumResponse.text();
        throw new Error(`Failed to save photo album: ${errorText}`);
      }

      databaseResult = await albumResponse.json();
      console.log(`✅ Photo album created:`, databaseResult);

      successMessage = results.failed.length > 0
        ? `Successfully uploaded ${results.successful.length} of ${uploadedImages.length} images to album "${albumName}". ${results.failed.length} failed.`
        : `Successfully uploaded all ${results.successful.length} images to album "${albumName}"!`;
    } else {
      // For other content types, just upload images to S3 (URLs stored for potential CSV linking)
      console.log(`💾 Images uploaded to S3 for ${selectedType}. URLs available for CSV linking...`);
      
      databaseResult = { urls: results.successful, contentType: selectedType };
      
      successMessage = results.failed.length > 0
        ? `Successfully uploaded ${results.successful.length} of ${uploadedImages.length} images for ${selectedType}. ${results.failed.length} failed. Images are ready for CSV linking.`
        : `Successfully uploaded all ${results.successful.length} images for ${selectedType}! Images are ready for CSV linking.`;
    }

    toast({
      title: "Images Uploaded Successfully!",
      description: successMessage,
      variant: "default",
    });

    return { success: true, results, databaseResult };

  } catch (error: any) {
    console.error('❌ Image upload failed:', error);
    
    toast({
      title: "Upload Failed",
      description: error.message || "Failed to upload images. Please try again.",
      variant: "destructive",
    });

    return { success: false, error };
  } finally {
    setIsImageUploading(false);
    setUploadProgress(() => ({ current: 0, total: 0, currentItem: '', completed: [], errors: [] }));
  }
};

// Data validation and transformation functions
export const applyPhotoUrlConversion = (data: any[], contentType: string) => {
  console.log(`🔄 Applying photo URL conversion for ${contentType}...`);
  
  return data.map((item, index) => {
    let processedItem = { ...item };
    
    // Define photo field mapping for each content type
    const photoFieldMappings: Record<string, string[]> = {
      speaker: ['photo', 'image', 'photo_url', 'avatar'],
      services: ['photo_url', 'image', 'photo'],
      activities: ['photo_url', 'image', 'photo'],
      exhibitor: ['photo', 'image', 'photo_url'],
      agenda: ['speaker_photo', 'photo', 'image'],
      guest: ['photo', 'avatar', 'image'],
      photos: [] // Photos don't need conversion as they're already URLs
    };

    const photoFields = photoFieldMappings[contentType] || [];
    
    // Process each potential photo field
    photoFields.forEach(fieldName => {
      if (processedItem[fieldName]) {
        const originalValue = processedItem[fieldName];
        
        // If it's already a URL, keep it as is
        if (typeof originalValue === 'string' && (originalValue.startsWith('http') || originalValue.startsWith('/'))) {
          return;
        }
        
        // Convert photo identifier to URL
        if (typeof originalValue === 'string' && originalValue.trim()) {
          const photoIdentifier = originalValue.trim();
          const sanitizedIdentifier = photoIdentifier.replace(/[^a-zA-Z0-9.-]/g, '_');
          
          // Use environment variables for bucket configuration
          const bucketName = process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME || 'nia-photosbucket';
          const region = process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1';
          
          // Construct the S3 URL using the assistant's subdomain structure
          const assistantSubdomain = 'default'; // This should be passed as parameter if needed
          const photoUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${assistantSubdomain}/photos/${contentType}/${sanitizedIdentifier}`;
          
          processedItem[fieldName] = photoUrl;
          
          if (index < 3) { // Log first few conversions for debugging
            console.log(`📸 ${fieldName}: "${originalValue}" → "${photoUrl}"`);
          }
        }
      }
    });

    // Remove items that have no meaningful data after processing
    // Check if the item has any non-empty values (excluding assistant_id)
    const itemKeys = Object.keys(processedItem).filter(key => key !== 'assistant_id');
    const hasAnyData = Object.keys(processedItem).some(key => {
      if (key === 'assistant_id') return false;
      const value = processedItem[key];
      return value !== null && value !== undefined && value !== '';
    });

    if (!hasAnyData) {
      console.log(`⚠️ Item ${index + 1} has no meaningful data, will be filtered out`);
      return null;
    }

    return processedItem;
  }).filter(item => item !== null); // Remove null items
};

export const validateAndTransformData = (
  data: any[],
  contentType: string
): ValidationResult => {
  console.log(`🔍 Processing ${data.length} items for ${contentType}...`);
  
  // Apply photo URL conversion first
  const convertedData = applyPhotoUrlConversion(data, contentType);
  console.log(`📸 Photo conversion complete: ${convertedData.length} items processed`);

  // Simple validation - just ensure data exists and add assistant_id
  const validData = convertedData.filter(item => {
    // For photos, just need url and album
    if (contentType === 'photos') {
      return item.url && item.album;
    }
    
    // For other types, just check if item has some data
    return item && typeof item === 'object' && Object.keys(item).length > 1; // More than just assistant_id
  });

  console.log(`📊 Processing complete: ${validData.length} valid items`);

  return {
    validData,
    errors: [],
    hasErrors: false
  };
};

// File upload and processing
export const handleUpload = async (file: File) => {
  console.log(`📁 Processing file: ${file.name} (${file.type})`);
  
  const isJson = file.name.endsWith('.json') ||
    file.type === 'application/json' ||
    file.type === 'text/json' ||
    file.type.includes('json');

  const isCsv = file.name.endsWith('.csv') ||
    file.type === 'text/csv';

  const isExcel = file.name.endsWith('.xlsx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  console.log(`📋 File type detection:`, {
    fileName: file.name,
    mimeType: file.type,
    isJson,
    isCsv,
    isExcel
  });

  let parsedData: any[] = [];

  try {
    if (isExcel) {
      console.log("📊 Processing Excel file...");
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      
      console.log("📋 Excel workbook sheets:", workbook.SheetNames);
      
      // Use the first sheet
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Convert to JSON with header row
      parsedData = XLSX.utils.sheet_to_json(worksheet, { 
        header: 1,
        defval: "",
        blankrows: false
      });
      
      // Convert array of arrays to array of objects using first row as headers
      if (parsedData.length > 1) {
        const headers = parsedData[0] as string[];
        parsedData = parsedData.slice(1).map((row: any[]) => {
          const obj: any = {};
          headers.forEach((header, index) => {
            obj[header] = row[index] || "";
          });
          return obj;
        });
      }
      
      console.log(`✅ Excel parsed: ${parsedData.length} rows`);
      
    } else if (isCsv) {
      console.log("📄 Processing CSV file...");
      const content = await file.text();
      
      console.log("📝 CSV content preview:", content.substring(0, 200));
      
      const csvData = Papa.parse(content, { header: true }).data;
      // Filter out empty rows
      const filteredCsvData = csvData.filter((row: any) =>
        Object.values(row).some(value => value !== null && value !== undefined && String(value).trim() !== "")
      );
      
      parsedData = filteredCsvData;
      console.log(`✅ CSV parsed: ${parsedData.length} rows (${csvData.length - parsedData.length} empty rows filtered)`);
      
    } else if (isJson) {
      console.log("🔤 Processing JSON file...");
      const content = await file.text();
      
      console.log("📝 JSON content preview:", content.substring(0, 200));
      
      const jsonData = JSON.parse(content);
      
      // Handle both array and object formats
      if (Array.isArray(jsonData)) {
        parsedData = jsonData;
      } else if (typeof jsonData === 'object' && jsonData !== null) {
        // If it's a single object, wrap it in an array
        parsedData = [jsonData];
      } else {
        throw new Error('JSON file must contain an array or object');
      }
      
      console.log(`✅ JSON parsed: ${parsedData.length} items`);
      
    } else {
      throw new Error(`Unsupported file type: ${file.type}. Please upload CSV, Excel (.xlsx), or JSON files.`);
    }

    console.log("📊 Parsed data sample:", parsedData.slice(0, 2));
    console.log(`✅ File processing complete: ${parsedData.length} items extracted`);
    
    return parsedData;

  } catch (error: any) {
    console.error(`❌ File processing failed:`, error);
    throw new Error(`Failed to process ${file.name}: ${error.message}`);
  }
};

// Data upload confirmation
export const handleConfirmUpload = async (
  previewData: any[],
  selectedType: string,
  assistantId: string,
  setIsUploading: (value: boolean) => void,
  setUploadProgress: (updater: (prev: UploadProgress) => UploadProgress) => void,
  toast: any
) => {
  if (!selectedType || !previewData.length) {
    toast({
      title: "Upload Error",
      description: "No data to upload or content type not selected.",
      variant: "destructive",
    });
    return;
  }

  console.log(`🚀 Starting confirmed upload for ${selectedType}...`);
  console.log(`📊 Data items: ${previewData.length}`);
  console.log(`👤 Assistant: ${assistantId}`);

  setIsUploading(true);
  setUploadProgress(() => ({
    current: 0,
    total: previewData.length,
    currentItem: 'Validating data...',
    completed: [],
    errors: []
  }));

  try {
    // Process and transform data (no strict validation)
    const validationResult = validateAndTransformData(previewData, selectedType);
    const dataToUpload = validationResult.validData;
    
    if (dataToUpload.length === 0) {
      throw new Error(`No valid data found to upload. Please check your file contents.`);
    }
    console.log(`📤 Uploading ${dataToUpload.length} validated items...`);

    setUploadProgress(prev => ({
      ...prev,
      currentItem: `Uploading ${dataToUpload.length} items to database...`
    }));

    // Get content configuration
    const config = contentConfig[selectedType as keyof typeof contentConfig];
    
    if (!config) {
      throw new Error(`Configuration not found for content type: ${selectedType}`);
    }

    // Upload to database
    const response = await fetch('/api/upload-content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contentType: selectedType,
        collectionName: config.collectionName,
        data: dataToUpload,
        assistantId: assistantId
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const result = await response.json() as UploadResult;
    console.log(`✅ Upload successful:`, result);

    // Success notification
    toast({
      title: "Upload Successful!",
      description: `Successfully uploaded ${result.insertedCount || dataToUpload.length} ${selectedType} items.`,
      variant: "default",
    });

    // Debug information
    if (process.env.NODE_ENV === 'development') {
      try {
        const debugResponse = await fetch(`/api/debug-upload?assistantId=${assistantId}`);
        const debugData = await debugResponse.json();
        console.log('🔍 Post-upload debug info:', debugData);
      } catch (debugError) {
        console.warn('Debug info fetch failed:', debugError);
      }
    }

    return { success: true, result };

  } catch (error: any) {
    console.error('❌ Upload failed:', error);
    
    toast({
      title: "Upload Failed",
      description: error.message || "An unexpected error occurred during upload.",
      variant: "destructive",
    });

    return { success: false, error };
  } finally {
    setIsUploading(false);
    setUploadProgress(() => ({ current: 0, total: 0, currentItem: '', completed: [], errors: [] }));
  }
}; 