import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTrigger } from "./ui/dialog";
import { UploadButton } from "./upload-button";
import { useState, useEffect } from "react";
import { 
  CloudUpload, X, File, CheckCircle, Mic, Calendar, Ship, User, Image, 
  Settings, Box, Activity, Code, Loader2, Clock, Check, Upload, ImageIcon, 
  FileText, FolderUp 
} from "lucide-react";
import { AssistantBlock } from "@nia/prism/core/blocks";
import { useToast } from "@dashboard/hooks/use-toast";
import { Progress } from "./ui/progress";
import { Badge } from "./ui/badge";

// Import configurations and services
import { 
  contentTypes, 
  contentConfig, 
  formatDataWithAssistantId,
  UploadProgress 
} from "@dashboard/config/upload-content-config";
import { 
  processImageFiles,
  handleUpload as serviceHandleUpload,
  handleConfirmUpload as serviceHandleConfirmUpload,
  handleImageUpload as serviceHandleImageUpload
} from "@dashboard/services/upload-content-service";

// Content Type Selection Component
const ContentTypeSelection = ({ onSelect }: { onSelect: (type: string) => void }) => (
  <div className="text-center space-y-6">
    <p className="text-muted-foreground">What type of content would you like to upload?</p>
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {contentTypes.map(({ label, value }) => {
        const config = contentConfig[value];
        const iconMap: Record<string, any> = {
          guest: User, services: Settings, activities: Activity, speaker: Mic,
          agenda: Calendar, eventMap: Ship, iframeKeywords: Code, knowledgeKeywords: Box,
          exhibitor: User, photos: ImageIcon
        };
        const Icon = iconMap[value] || File;
        
        return (
          <button
            key={value}
            onClick={() => onSelect(value)}
            className="group relative overflow-hidden rounded-xl border bg-card p-6 text-left transition-all hover:border-primary hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <div className="flex flex-col items-center space-y-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted group-hover:bg-primary/10">
                <Icon className="h-6 w-6 text-muted-foreground group-hover:text-primary" />
              </div>
              <div className="text-center">
                <h4 className="text-sm font-medium text-foreground">
                  {value === 'photos' ? 'Photo Albums' : (config?.collectionName || label)}
                </h4>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  </div>
);

// Upload Options Panel Component
const UploadOptionsPanel = ({ 
  selectedType, 
  uploadMode, 
  setUploadMode, 
  onReset 
}: {
  selectedType: string;
  uploadMode: 'data' | 'images' | null;
  setUploadMode: (mode: 'data' | 'images' | null) => void;
  onReset: () => void;
}) => (
  <div className="border rounded-xl p-6 bg-card">
    <div className="flex items-center gap-3 text-base font-medium mb-6">
      <File className="h-6 w-6 text-muted-foreground" />
      <span className="text-lg">{selectedType.replace(/([A-Z])/g, ' $1')} Upload Options</span>
    </div>
    
    <div className="space-y-4">
      {selectedType === 'photos' ? (
        <div 
          className={`border-2 border-dashed rounded-lg p-6 cursor-pointer transition-all ${
            uploadMode === 'images' 
              ? 'border-purple-500 bg-purple-500/10' 
              : 'border-border hover:border-purple-400 hover:bg-purple-500/5'
          } group`}
          onClick={() => setUploadMode(uploadMode === 'images' ? null : 'images')}
        >
          <div className="text-center space-y-3">
            <div className="mx-auto h-12 w-12 bg-purple-500/10 rounded-lg flex items-center justify-center group-hover:bg-purple-500/20 transition-colors">
              <ImageIcon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            </div>
            <h3 className="text-lg font-semibold">Photo Album</h3>
            <p className="text-sm text-muted-foreground">Upload photos to create albums</p>
            <div className="flex flex-wrap gap-1 justify-center">
              <Badge variant="outline" className="text-xs">JPG</Badge>
              <Badge variant="outline" className="text-xs">PNG</Badge>
              <Badge variant="outline" className="text-xs">ZIP</Badge>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div 
            className={`border-2 border-dashed rounded-lg p-6 cursor-pointer transition-all ${
              uploadMode === 'data' 
                ? 'border-green-500 bg-green-500/10' 
                : 'border-border hover:border-green-400 hover:bg-green-500/5'
            } group`}
            onClick={() => setUploadMode(uploadMode === 'data' ? null : 'data')}
          >
            <div className="text-center space-y-3">
              <div className="mx-auto h-12 w-12 bg-green-500/10 rounded-lg flex items-center justify-center group-hover:bg-green-500/20 transition-colors">
                <FileText className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-lg font-semibold">Data Upload</h3>
              <p className="text-sm text-muted-foreground">Upload structured data files</p>
              <div className="flex flex-wrap gap-1 justify-center">
                <Badge variant="outline" className="text-xs">CSV</Badge>
                <Badge variant="outline" className="text-xs">Excel</Badge>
                <Badge variant="outline" className="text-xs">JSON</Badge>
              </div>
            </div>
          </div>

          <div 
            className={`border-2 border-dashed rounded-lg p-6 cursor-pointer transition-all ${
              uploadMode === 'images' 
                ? 'border-purple-500 bg-purple-500/10' 
                : 'border-border hover:border-purple-400 hover:bg-purple-500/5'
            } group`}
            onClick={() => setUploadMode(uploadMode === 'images' ? null : 'images')}
          >
            <div className="text-center space-y-3">
              <div className="mx-auto h-12 w-12 bg-purple-500/10 rounded-lg flex items-center justify-center group-hover:bg-purple-500/20 transition-colors">
                <ImageIcon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <h3 className="text-lg font-semibold">Image Assets</h3>
              <p className="text-sm text-muted-foreground">Upload image assets</p>
              <div className="flex flex-wrap gap-1 justify-center">
                <Badge variant="outline" className="text-xs">JPG</Badge>
                <Badge variant="outline" className="text-xs">PNG</Badge>
                <Badge variant="outline" className="text-xs">ZIP</Badge>
              </div>
            </div>
          </div>
        </>
      )}
    </div>

    <div className="mt-6 pt-4 border-t">
      <Button variant="outline" onClick={onReset} className="w-full">
        ← Choose Different Content Type
      </Button>
    </div>
  </div>
);

// Data Upload Interface Component
const DataUploadInterface = ({ selectedType, onUploadFile }: {
  selectedType: string;
  onUploadFile: (file: File) => void;
}) => (
  <div className="border rounded-xl p-6 bg-green-500/5 space-y-6">
    <div className="flex items-center gap-3">
      <div className="h-12 w-12 bg-green-500/10 rounded-lg flex items-center justify-center">
        <FileText className="h-6 w-6 text-green-600 dark:text-green-400" />
      </div>
      <div>
        <h3 className="text-xl font-semibold">Data Upload</h3>
        <p className="text-sm text-muted-foreground">Upload structured data files for {selectedType}</p>
      </div>
    </div>
    
    <div className="space-y-4">
      <div className="bg-card p-6 rounded-lg border">
        <div className="text-center space-y-4">
          <div className="flex gap-4 justify-center">
            <UploadButton 
              onUpload={onUploadFile} 
              accept=".csv, .xlsx, text/csv, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              label="CSV/Excel File"
              icon={<File className="h-4 w-4 mr-2" />}
            />
            <UploadButton 
              onUpload={onUploadFile} 
              accept=".json,application/json,text/json,json"
              label="JSON File"
              icon={<File className="h-4 w-4 mr-2" />}
            />
          </div>
          <p className="text-xs text-muted-foreground">Supported formats: CSV, Excel (.xlsx), JSON</p>
        </div>
      </div>
    </div>
  </div>
);

// Image Upload Interface Component
const ImageUploadInterface = ({ 
  selectedType, 
  albumName, 
  setAlbumName, 
  dragActive, 
  handleDrag, 
  handleDrop, 
  handleImageFileSelect, 
  uploadedImages, 
  removeImage, 
  onImageUpload, 
  isImageUploading,
  assistantSubdomain 
}: {
  selectedType: string;
  albumName: string;
  setAlbumName: (name: string) => void;
  dragActive: boolean;
  handleDrag: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleImageFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploadedImages: File[];
  removeImage: (index: number) => void;
  onImageUpload: () => void;
  isImageUploading: boolean;
  assistantSubdomain: string;
}) => (
  <div className="border rounded-xl p-6 bg-purple-500/5 space-y-6">
    <div className="flex items-center gap-3">
      <div className="h-12 w-12 bg-purple-500/10 rounded-lg flex items-center justify-center">
        <ImageIcon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
      </div>
      <div>
        <h3 className="text-xl font-semibold">
          {selectedType === 'photos' ? 'Photo Album' : 'Image Assets'}
        </h3>
        <p className="text-sm text-muted-foreground">
          {selectedType === 'photos' 
            ? 'Create photo albums with organized image collections'
            : 'Upload image assets for your assistant'}
        </p>
      </div>
    </div>
    
    <div className="space-y-4">
      {selectedType === 'photos' && (
        <div className="bg-card p-4 rounded-lg border">
          <label htmlFor="albumName" className="block text-sm font-medium mb-2">
            Album Name <span className="text-red-500">*</span>
          </label>
          <input
            id="albumName"
            type="text"
            value={albumName}
            onChange={(e) => setAlbumName(e.target.value)}
            placeholder="Enter album name"
            className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent bg-background"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Photos will be stored in: {assistantSubdomain}/photos/{albumName || 'album-name'}/
          </p>
        </div>
      )}
      
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors bg-card ${
          dragActive 
            ? 'border-purple-500 bg-purple-500/10' 
            : 'border-border hover:border-gray-400'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="space-y-4">
          <div className="mx-auto h-16 w-16 bg-purple-500/10 rounded-xl flex items-center justify-center">
            <Upload className="h-8 w-8 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <p className="text-lg font-medium">Drag & drop images or ZIP files here</p>
            <p className="text-sm text-muted-foreground">Or click to select files</p>
            <p className="text-xs text-muted-foreground mt-2">ZIP files will be automatically extracted</p>
          </div>
          <input
            type="file"
            id="imageUpload"
            multiple
            accept="image/*,.zip"
            onChange={handleImageFileSelect}
            className="hidden"
          />
          <Button
            onClick={() => document.getElementById('imageUpload')?.click()}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            <ImageIcon className="mr-2 h-4 w-4" />
            Select Images & ZIP Files
          </Button>
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>Supported:</strong> JPG, PNG, GIF, WEBP, ZIP files</p>
            <p><strong>ZIP files:</strong> Images will be extracted automatically</p>
            <p><strong>Max file size:</strong> 10MB per file</p>
          </div>
        </div>
      </div>

      {uploadedImages.length > 0 && (
        <div className="space-y-3 bg-card p-4 rounded-lg border">
          <h4 className="font-medium">
            Staged Images ({uploadedImages.length})
            <span className="text-sm font-normal text-muted-foreground ml-2">
              Ready for upload to {selectedType === 'photos' 
                ? `${assistantSubdomain}/photos/${albumName || 'album-name'}/`
                : `${assistantSubdomain}/images/`}
            </span>
          </h4>
          <div className="grid grid-cols-4 gap-3 max-h-48 overflow-y-auto">
            {uploadedImages.map((file, index) => {
              const displayName = file.name.length > 20 ? `${file.name.substring(0, 17)}...` : file.name;
              return (
                <div key={index} className="aspect-square bg-muted rounded flex items-center justify-center relative">
                  <div className="p-2 text-center">
                    <ImageIcon className="h-6 w-6 mx-auto mb-1 text-muted-foreground" />
                    <p className="text-xs truncate mt-1" title={file.name}>{displayName}</p>
                    <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => removeImage(index)}
                      className="absolute -top-2 -right-2 h-6 w-6 p-0 rounded-full"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <Button 
            onClick={onImageUpload} 
            disabled={isImageUploading || (selectedType === 'photos' && !albumName)} 
            className="w-full bg-purple-600 hover:bg-purple-700 text-white"
          >
            {isImageUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload Images
              </>
            )}
          </Button>
        </div>
      )}

      {isImageUploading && (
        <div className="space-y-3 bg-purple-500/10 p-4 rounded-lg">
          <div className="flex justify-between text-sm">
            <span>Uploading Images</span>
            <span>In progress...</span>
          </div>
          <Progress value={50} />
          <p className="text-sm text-muted-foreground">Uploading images to S3...</p>
        </div>
      )}
    </div>
  </div>
);

// Preview Panel Component  
const PreviewPanel = ({ 
  showPreview, 
  previewData, 
  isUploading, 
  onClose, 
  onConfirm, 
  uploadProgress 
}: {
  showPreview: boolean;
  previewData: any[];
  isUploading: boolean;
  onClose: () => void;
  onConfirm: () => void;
  uploadProgress: UploadProgress;
}) => (
  <>
    {showPreview && (
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-card rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
          <div className="p-6 border-b flex justify-between items-center">
            <h3 className="text-2xl font-bold">Preview Data</h3>
            <X className="h-6 w-6 cursor-pointer text-muted-foreground hover:text-foreground" onClick={onClose} />
          </div>
          <div className="p-6">
            <pre className="flex-1 overflow-auto text-sm mb-6 p-4 bg-muted rounded-lg max-h-64">
              {JSON.stringify(previewData.slice(0, 5), null, 2)}
            </pre>
            <div className="flex gap-4">
              <Button variant="outline" onClick={onClose} disabled={isUploading}>
                Cancel
              </Button>
              <Button onClick={onConfirm} disabled={isUploading}>
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  `Confirm Upload (${previewData.length} items)`
                )}
              </Button>
            </div>
          </div>

          {isUploading && (
            <>
              <div className="px-6 pb-6">
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary animate-pulse" />
                  Upload Progress
                </h3>
                <div className="text-sm text-muted-foreground">{uploadProgress.current} / {uploadProgress.total}</div>
              </div>
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Overall Progress</span>
                    <span>{uploadProgress.current === 0 && uploadProgress.total > 0 ? "Initializing..." : `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%`}</span>
                  </div>
                  <Progress value={(uploadProgress.current / uploadProgress.total) * 100} className="h-3" />
                </div>
                <div className="flex items-center gap-3 p-4 bg-blue-500/10 rounded-lg border border-blue-500/20">
                  <Clock className="h-5 w-5 text-blue-600 animate-pulse" />
                  <span className="text-sm font-medium">{uploadProgress.currentItem}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    )}
  </>
);

export function UploadContentButton({ assistant }: { assistant: AssistantBlock.IAssistant }) {
  // State management
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [uploadMode, setUploadMode] = useState<'data' | 'images' | null>(null);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isImageUploading, setIsImageUploading] = useState(false);
  const [assistantSubdomain, setAssistantSubdomain] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    current: 0, total: 0, currentItem: '', completed: [], errors: []
  });
  const [dragActive, setDragActive] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<File[]>([]);
  const [albumName, setAlbumName] = useState<string>('');
  
  const { toast } = useToast();

  // Initialize assistant data
  useEffect(() => {
    setAssistantSubdomain(assistant.subDomain || `assistant-${assistant._id}`);
  }, [assistant]);

  // Event handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = e.dataTransfer.files;
    if (files?.length) {
      const processedFiles = await processImageFiles(files);
      setUploadedImages(prev => [...prev, ...processedFiles]);
      toast({ title: "Files Added", description: `Added ${processedFiles.length} image files for upload` });
    }
  };

  const handleImageFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files?.length) {
      const processedFiles = await processImageFiles(files);
      setUploadedImages(prev => [...prev, ...processedFiles]);
      toast({ title: "Files Selected", description: `Selected ${processedFiles.length} image files for upload` });
    }
  };

  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async (file: File) => {
    try {
      const data = await serviceHandleUpload(file);
      const formattedData = formatDataWithAssistantId(data, assistant._id!);
      setPreviewData(formattedData);
      setShowPreview(true);
    } catch (error: any) {
      toast({ title: "Upload Error", description: error.message || "Failed to process file.", variant: "destructive" });
    }
  };

  const handleConfirmUpload = async () => {
    try {
      await serviceHandleConfirmUpload(previewData, selectedType!, assistant._id!, setIsUploading, setUploadProgress, toast);
      setShowPreview(false);
      setPreviewData([]);
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    } catch (error: any) {
      toast({ title: "Upload Failed", description: error.message, variant: "destructive" });
    }
  };

  const handleImageUpload = async () => {
    try {
      await serviceHandleImageUpload(uploadedImages, albumName, assistantSubdomain, selectedType, assistant._id!, setIsImageUploading, setUploadProgress, toast);
      setUploadedImages([]);
      setAlbumName('');
    } catch (error: any) {
      toast({ title: "Upload Failed", description: error.message, variant: "destructive" });
    }
  };

  const resetSelection = () => {
    setSelectedType(null);
    setUploadMode(null);
    setPreviewData([]);
    setShowPreview(false);
    setAlbumName('');
    setUploadedImages([]);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="bg-gradient-to-r from-[#0097B2] to-[#003E49] hover:from-[#008299] hover:to-[#00313A] text-white">
          <Upload className="mr-2 h-4 w-4" />
          Upload Files
        </Button>
      </DialogTrigger>
      <DialogContent className={`rounded-xl p-8 transition-all duration-300 ${uploadMode ? 'sm:max-w-7xl' : 'sm:max-w-4xl'}`}>
        <div className="space-y-8">
          <div className="text-center space-y-4">
            <div className="mx-auto h-20 w-20 bg-primary/10 rounded-xl flex items-center justify-center">
              <CloudUpload className="h-10 w-10 text-primary" />
            </div>
            <h3 className="text-3xl font-bold tracking-tight">Content Upload</h3>
            <p className="text-muted-foreground">Select content type and choose between data files or image assets</p>
          </div>

          {!selectedType && (
            <ContentTypeSelection onSelect={(type) => {
              setSelectedType(type);
              if (type === 'photos') setUploadMode('images');
            }} />
          )}

          {selectedType && (
            <div className={`grid transition-all duration-300 ${uploadMode ? 'grid-cols-5 gap-8' : 'grid-cols-1'}`}>
              <div className={`${uploadMode ? 'col-span-2' : 'col-span-1'} space-y-6`}>
                <UploadOptionsPanel 
                  selectedType={selectedType}
                  uploadMode={uploadMode}
                  setUploadMode={setUploadMode}
                  onReset={resetSelection}
                />
              </div>

              {uploadMode && (
                <div className="col-span-3 animate-in slide-in-from-right-4 duration-300">
                  {uploadMode === 'data' && (
                    <DataUploadInterface selectedType={selectedType} onUploadFile={handleUpload} />
                  )}

                  {uploadMode === 'images' && (
                    <ImageUploadInterface 
                      selectedType={selectedType}
                      albumName={albumName}
                      setAlbumName={setAlbumName}
                      dragActive={dragActive}
                      handleDrag={handleDrag}
                      handleDrop={handleDrop}
                      handleImageFileSelect={handleImageFileSelect}
                      uploadedImages={uploadedImages}
                      removeImage={removeImage}
                      onImageUpload={handleImageUpload}
                      isImageUploading={isImageUploading}
                      assistantSubdomain={assistantSubdomain}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <PreviewPanel 
          showPreview={showPreview}
          previewData={previewData}
          isUploading={isUploading}
          onClose={() => setShowPreview(false)}
          onConfirm={handleConfirmUpload}
          uploadProgress={uploadProgress}
        />
      </DialogContent>
    </Dialog>
  );
} 