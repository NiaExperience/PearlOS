import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ChangeEvent } from "react";

export function UploadButton({ 
  onUpload, 
  label = "Upload CSV",
  accept,
  icon 
}: { 
  onUpload: (file: File) => void;
  label?: string;
  accept?: string;
  icon?: React.ReactNode;
}) {
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
    }
  };

  return (
    <div className="relative">
      <Input
        type="file"
        onChange={handleFileChange}
        className="hidden"
        id="upload-button"
        accept={accept}
      />
      <Button
        type="button"
        variant="outline"
        className="gap-2"
        onClick={() => document.getElementById('upload-button')?.click()}
      >
        {icon}
        {label}
      </Button>
    </div>
  );
} 