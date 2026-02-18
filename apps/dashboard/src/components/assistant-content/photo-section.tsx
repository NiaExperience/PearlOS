import { Button } from '@dashboard/components/ui/button';
import { Input } from '@dashboard/components/ui/input';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ImageUrl, Photo } from '../../types/assistant-content/photo';
import EditableImageTable from '../editable-image-table';
import { ITool } from '@nia/prism/core/blocks/tool.block';

interface PhotoSectionProps {
  selectedAssistant: any;
  photoTool?: ITool; // If available, pass the tool for EditableImageTable
}

export default function PhotoSection({ selectedAssistant: assistant, photoTool }: PhotoSectionProps) {
  const [imageUrls, setImageUrls] = useState<ImageUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const contentType = 'Photo';
  const isSupported = assistant?.contentTypes?.includes(contentType);

  useEffect(() => {
    if (!isSupported) return;
    setLoading(true);
    fetch(`/api/contentList?type=Photo&assistantId=${assistant._id}`)
      .then(res => res.json())
      .then(data => {
        // Flatten all imageUrls from all Photo blocks
        const urls: ImageUrl[] = [];
        (data.items || []).forEach((photo: Photo) => {
          (photo.imageUrls || []).forEach((img: any) => {
            urls.push({
              ...img,
              _id: img._id || '',
              photoId: photo._id,
              album: img.album || photo.album || '',
            });
          });
        });
        setImageUrls(urls);
      })
      .finally(() => setLoading(false));
  }, [assistant, isSupported]);

  const filteredImageUrls = imageUrls.filter(
    imageUrl =>
      imageUrl.url.toLowerCase().includes(searchTerm.toLowerCase()) ||
      imageUrl.album.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const matchCount = filteredImageUrls.length;

  useEffect(() => {
    setMatchIndex(0);
  }, [searchTerm]);

  const handlePrevMatch = () => {
    setMatchIndex(prev => (prev > 0 ? prev - 1 : matchCount - 1));
  };
  const handleNextMatch = () => {
    setMatchIndex(prev => (prev < matchCount - 1 ? prev + 1 : 0));
  };

  const handleImageDeleted = (deletedUrl: ImageUrl) => {
    setImageUrls(prev => prev.filter(url => url._id !== deletedUrl._id));
  };
  const handleImageAdded = (newUrl: ImageUrl) => {
    setImageUrls(prev => [...prev, newUrl]);
  };
  const handleImageUpdated = (updatedUrl: ImageUrl) => {
    setImageUrls(prev => prev.map(url => (url._id === updatedUrl._id ? updatedUrl : url)));
  };

  if (!isSupported) {
    return <div>This content type is not supported by {assistant?.name}</div>;
  }

  // If photoTool is not present, show instructional text
  if (!photoTool) {
    return (
      <div className="p-4 text-muted-foreground text-sm">
        To enable photo management, please add or configure a Photo Tool for this assistant.
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Content</h2>
          <p className="text-sm text-muted-foreground">
            Configure the content of your assistant. This includes the information that your
            assistant will use to generate responses. This is where you can add your
            assistant&apos;s knowledge base. You can also add photos and videos to your
            assistant&apos;s content.
          </p>
        </div>
      </div>

      <div className="flex w-full items-center gap-2">
        <div className="relative flex-grow">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by URL or album"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-8 w-full"
          />
          {searchTerm && (
            <div className="absolute right-3 top-2.5 text-sm text-muted-foreground">
                  {matchCount > 0 ? `${matchIndex + 1} /` : ""} {matchCount}{" "}
                  found
            </div>
          )}
        </div>
        {searchTerm && matchCount > 0 && (
          <>
            <Button type="button" variant="outline" onClick={handlePrevMatch}>
              Prev
            </Button>
            <Button type="button" variant="outline" onClick={handleNextMatch}>
              Next
            </Button>
          </>
        )}
      </div>
      <div className="flex flex-col justify-start items-start gap-2">
        <EditableImageTable
          tool={photoTool}
          assistantId={assistant._id}
          imageUrls={filteredImageUrls}
          isLoading={loading}
          onImageAdded={handleImageAdded}
          onImageDeleted={handleImageDeleted}
          onImageUpdated={handleImageUpdated}
          searchTerm={searchTerm}
          matchIndex={matchIndex}
        />
      </div>
    </div>
  );
}
