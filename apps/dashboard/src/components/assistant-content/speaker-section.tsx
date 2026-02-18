import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@dashboard/components/ui/alert-dialog";
import { Button } from "@dashboard/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dashboard/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@dashboard/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@dashboard/components/ui/form";
import { Input } from "@dashboard/components/ui/input";
import { Textarea } from "@dashboard/components/ui/textarea";
import { toast } from "@dashboard/hooks/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { Speaker as ISpeaker, SpeakerSchema } from "../../types/assistant-content/speaker";
import { ChevronDown, ChevronLeft, ChevronRight, Info, Pencil, PlusCircle, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { ITool } from "@nia/prism/core/blocks/tool.block";
import { IAssistant } from "@nia/prism/core/blocks/assistant.block";

interface SpeakerFormData {
  assistant_id: string;
  name: string;
  title: string;
  company: string;
  photo: string;
  session: string;
  dayTime: string;
  bio: string;
  categories: string[];
  [key: string]: unknown; // Add index signature to allow Record<string, unknown>
}

const isImageUrl = (url: string) => {
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
};

const Highlight = ({ text, highlight }: { text: string; highlight: string }) => {
  if (!text) return null;
  if (!highlight.trim()) {
    return <span>{text}</span>;
  }
  const regex = new RegExp(`(${highlight})`, 'gi');
  const parts = text.split(regex);
  return (
    <span>
      {parts.map((part, i) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <mark key={i} className="bg-yellow-300 dark:bg-yellow-500 rounded-sm">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  );
};

interface SpeakerSectionProps {
  selectedAssistant: IAssistant;
  speakerTool?: ITool;
}

export default function SpeakerSection({
  selectedAssistant,
  speakerTool,
}: SpeakerSectionProps) {
  const [speakers, setSpeakers] = useState<ISpeaker[]>([]);
  const [showSpeakerModal, setShowSpeakerModal] = useState(false);
  const [editingSpeaker, setEditingSpeaker] = useState<ISpeaker | null>(null);
  const [speakerToDelete, setSpeakerToDelete] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    speakers: false,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredSpeakers, setFilteredSpeakers] = useState<ISpeaker[]>([]);
  const [searchMatches, setSearchMatches] = useState<{ rowIndex: number; cellIndex: number }[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const [showSpeakerDetailsModal, setShowSpeakerDetailsModal] = useState(false);
  const [selectedSpeakerDetails, setSelectedSpeakerDetails] = useState<ISpeaker | null>(null);

  const speakerForm = useForm<SpeakerFormData>({
    resolver: zodResolver(SpeakerSchema),
    mode: "onSubmit",
    defaultValues: {
      assistant_id: selectedAssistant._id!,
      name: "",
      title: "",
      company: "",
      photo: "",
      session: "",
      dayTime: "",
      bio: "",
      categories: [] as string[],
    },
  });

  useEffect(() => {
    const fetchSpeakers = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/contentList/speakers/${selectedAssistant._id}`);
        if (response.ok) {
          const data = await response.json();
          setSpeakers(data as ISpeaker[]);
        }
      } catch (error) {
        console.error("Error fetching speakers:", error);
        toast({
          title: "Error",
          description: "Failed to fetch speakers.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    if (speakerTool) {
      fetchSpeakers();
    } else {
      setIsLoading(false);
    }
  }, [selectedAssistant._id, speakerTool]);

  useEffect(() => {
    if (!searchQuery) {
      setFilteredSpeakers(speakers);
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }

    const lowercasedQuery = searchQuery.toLowerCase();
    const newFilteredSpeakers = speakers.filter(
      (item) =>
        (item.name || '').toLowerCase().includes(lowercasedQuery) ||
        (item.title || '').toLowerCase().includes(lowercasedQuery) ||
        (item.company || '').toLowerCase().includes(lowercasedQuery) ||
        (item.session || '').toLowerCase().includes(lowercasedQuery) ||
        (item.dayTime || '').toLowerCase().includes(lowercasedQuery) ||
        (item.bio || '').toLowerCase().includes(lowercasedQuery) ||
        item.categories.some(cat => (cat || '').toLowerCase().includes(lowercasedQuery))
    );
    setFilteredSpeakers(newFilteredSpeakers);

    const newMatches: { rowIndex: number; cellIndex: number }[] = [];
    newFilteredSpeakers.forEach((item, rowIndex) => {
      if ((item.name || '').toLowerCase().includes(lowercasedQuery)) newMatches.push({ rowIndex, cellIndex: 0 });
      if ((item.title || '').toLowerCase().includes(lowercasedQuery)) newMatches.push({ rowIndex, cellIndex: 1 });
      if ((item.company || '').toLowerCase().includes(lowercasedQuery)) newMatches.push({ rowIndex, cellIndex: 2 });
      if ((item.photo || '').toLowerCase().includes(lowercasedQuery)) newMatches.push({ rowIndex, cellIndex: 3 });
      if ((item.session || '').toLowerCase().includes(lowercasedQuery)) newMatches.push({ rowIndex, cellIndex: 4 });
      if ((item.dayTime || '').toLowerCase().includes(lowercasedQuery)) newMatches.push({ rowIndex, cellIndex: 5 });
      // Removed Bio from rendered table, so no highlight cell for it
      if (item.categories.some(cat => (cat || '').toLowerCase().includes(lowercasedQuery))) newMatches.push({ rowIndex, cellIndex: 6 });
    });
    setSearchMatches(newMatches);
    setCurrentMatchIndex(newMatches.length > 0 ? 0 : -1);
  }, [searchQuery, speakers]);

  useEffect(() => {
    if (currentMatchIndex !== -1 && searchMatches.length > 0) {
      const { rowIndex } = searchMatches[currentMatchIndex];
      rowRefs.current[rowIndex]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [currentMatchIndex, searchMatches]);

  const handleNextMatch = () => {
    if (searchMatches.length > 0) {
      setCurrentMatchIndex((prevIndex) => (prevIndex + 1) % searchMatches.length);
    }
  };

  const handlePrevMatch = () => {
    if (searchMatches.length > 0) {
      setCurrentMatchIndex((prevIndex) => (prevIndex - 1 + searchMatches.length) % searchMatches.length);
    }
  };

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleEditSpeaker = async (data: SpeakerFormData) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/contentDetail/speakers/${editingSpeaker?._id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });
      if (response.ok) {
        const updatedSpeakers = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/contentList/speakers/${selectedAssistant._id}`);
        if (updatedSpeakers.ok) {
          const data = await updatedSpeakers.json();
          setSpeakers(data as ISpeaker[]);
        }
        setEditingSpeaker(null);
        setShowSpeakerModal(false);
        speakerForm.reset({
          assistant_id: selectedAssistant._id!,
          name: "",
          title: "",
          company: "",
          photo: "",
          session: "",
          dayTime: "",
          bio: "",
          categories: [] as string[],
        });
        toast({ title: "Success", description: "Speaker updated successfully" });
      }
    } catch (error: unknown) {
      console.error("Error updating speaker:", error);
      toast({
        title: "Error",
        description: "Failed to update speaker",
        variant: "destructive",
      });
    }
  };

  const handleDeleteSpeaker = async (speakerId: string) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/contentDetail/speakers/${speakerId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        const updatedSpeakers = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/contentList/speakers/${selectedAssistant._id}`);
        if (updatedSpeakers.ok) {
          const data = await updatedSpeakers.json();
          setSpeakers(data as ISpeaker[]);
        }
        setSpeakerToDelete(null);
        toast({ title: "Success", description: "Speaker deleted successfully" });
      }
    } catch (error: unknown) {
      console.error("Error deleting speaker:", error);
      toast({
        title: "Error",
        description: "Failed to delete speaker",
        variant: "destructive",
      });
    }
  };

  if (!speakerTool) {
    return (
      <section className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Speaker Section</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center p-8 border rounded-lg bg-muted/10">
              <h3 className="text-lg font-semibold">Speaker Section Not Configured</h3>
              <p className="text-muted-foreground">
                Please ensure a speaker tool is assigned to this assistant.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold">Speakers</h2>
            <p className="text-sm text-muted-foreground">
              Manage event speakers and their information.
            </p>
          </div>
          <Dialog
            open={showSpeakerModal}
            onOpenChange={(open) => {
              if (!open) {
                speakerForm.reset({
                  assistant_id: selectedAssistant._id!,
                  name: "",
                  title: "",
                  company: "",
                  photo: "",
                  session: "",
                  dayTime: "",
                  bio: "",
                  categories: [] as string[],
                });
                setEditingSpeaker(null);
              }
              setShowSpeakerModal(open);
            }}
          >
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-[#0097B2] to-[#003E49] hover:from-[#008299] hover:to-[#00313A] text-white">
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Speaker
              </Button>
            </DialogTrigger>
            <DialogContent>
              <h2 className="text-lg font-semibold mb-4">
                {editingSpeaker ? "Edit Speaker" : "Create Speaker"}
              </h2>
              <Form {...speakerForm}>
                <form className="space-y-4">
                  <FormField
                    control={speakerForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Speaker name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={speakerForm.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Title</FormLabel>
                        <FormControl>
                          <Input placeholder="Title" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={speakerForm.control}
                    name="company"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company</FormLabel>
                        <FormControl>
                          <Input placeholder="Company" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={speakerForm.control}
                    name="photo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Photo URL</FormLabel>
                        <FormControl>
                          <Input placeholder="https://example.com/photo.jpg" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={speakerForm.control}
                    name="session"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Session</FormLabel>
                        <FormControl>
                          <Input placeholder="Session" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={speakerForm.control}
                    name="dayTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Day & Time</FormLabel>
                        <FormControl>
                          <Input placeholder="Day And Time" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={speakerForm.control}
                    name="bio"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bio</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Speaker biography" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={speakerForm.control}
                    name="categories"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Categories</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Enter categories separated by commas"
                            value={Array.isArray(field.value) ? field.value.join(", ") : ""}
                            onChange={(e) => {
                              const categories = e.target.value
                                .split(",")
                                .map((c) => c.trim())
                                .filter((c) => c.length > 0);
                              field.onChange(categories);
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    className="mt-4"
                    onClick={speakerForm.handleSubmit(async (data) => {
                      try {
                        if (editingSpeaker) {
                          await handleEditSpeaker(data);
                        } else {
                          const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/contentList/speakers/${selectedAssistant._id}`, {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                            },
                            body: JSON.stringify(data),
                          });
                          if (response.ok) {
                            const updatedSpeakers = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/contentList/speakers/${selectedAssistant._id}`);
                            if (
                              updatedSpeakers.ok
                            ) {
                              const data = await updatedSpeakers.json();
                              setSpeakers(
                                data as unknown as ISpeaker[]
                              );
                            }
                            setShowSpeakerModal(false);
                            speakerForm.reset({
                              assistant_id: selectedAssistant._id!,
                              name: "",
                              title: "",
                              company: "",
                              photo: "",
                              session: "",
                              dayTime: "",
                              bio: "",
                              categories: [] as string[],
                            });
                            toast({
                              title: "Success",
                              description: "Speaker created successfully",
                            });
                          }
                        }
                      } catch (error) {
                        console.error("Error saving speaker:", error);
                        toast({
                          title: "Error",
                          description: "Failed to save speaker",
                          variant: "destructive",
                        });
                      }
                    })}
                  >
                    {editingSpeaker ? "Update Speaker" : "Create Speaker"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center h-24">
            <p>Loading speakers...</p>
          </div>
        ) : speakers.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">All Speakers</h3>
              <div>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleSection("speakers")}
                    >
                      {collapsedSections.speakers ? "Expand" : "Collapse"}
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${collapsedSections.speakers ? "rotate-180" : ""
                          }`}
                      />
                    </Button>
                  </DialogTrigger>
                </Dialog>
              </div>
            </div>
            {!collapsedSections.speakers && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <Input
                    placeholder="Search speakers..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="max-w-sm"
                  />
                  {searchQuery && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {searchMatches.length > 0 ? `${currentMatchIndex + 1} of ` : ''}
                        {searchMatches.length} found
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handlePrevMatch}
                        disabled={searchMatches.length <= 1}
                        className="h-8 w-8"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handleNextMatch}
                        disabled={searchMatches.length <= 1}
                        className="h-8 w-8"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>

                {filteredSpeakers.length > 0 ? (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="relative max-h-[calc(100vh-25rem)] overflow-y-auto">
                      <table className="w-full table-fixed">
                        <thead>
                          <tr className="border-b bg-background sticky top-0 z-10">
                            <th className="text-left p-3 font-medium w-[15%]" >Name</th>
                            <th className="text-left p-3 font-medium w-[15%]" >Title</th>
                            <th className="text-left p-3 font-medium w-[15%]" >Company</th>
                            <th className="text-left p-3 font-medium w-[10%]" >Photo</th>
                            <th className="text-left p-3 font-medium w-[15%]" >Session</th>
                            <th className="text-left p-3 font-medium w-[15%]" >Day & Time</th>
                            {/* Removed Bio column */}
                            <th className="text-left p-3 font-medium w-[10%]" >Categories</th>
                            <th className="text-right p-3 font-medium w-[5%]" >Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredSpeakers.map((speaker, index) => (
                            <tr
                              key={speaker._id}
                              ref={(el) => { rowRefs.current[index] = el; }}
                              className={`${index % 2 === 0 ? "bg-background" : "bg-muted/30"} ${currentMatchIndex !== -1 && searchMatches[currentMatchIndex]?.rowIndex === index
                                ? 'outline outline-2 outline-offset-[-2px] outline-[#0097B2] dark:outline-[#0097B2]'
                                : ''
                                }`}
                            >
                              <td className="p-3"><Highlight text={speaker.name} highlight={searchQuery} /></td>
                              <td className="p-3"><Highlight text={speaker.title} highlight={searchQuery} /></td>
                              <td className="p-3"><Highlight text={speaker.company || ''} highlight={searchQuery} /></td>
                              <td className="p-3">
                                {/* Removed link from photo */}
                                {isImageUrl(speaker.photo || '') && (
                                  <div className="relative group">
                                    <img
                                      src={speaker.photo}
                                      alt="Speaker preview"
                                      className="h-12 w-12 object-cover rounded-md border"
                                      onError={(e) => {
                                        const target = e.target as HTMLImageElement;
                                        target.onerror = null;
                                        target.style.display = "none";
                                      }}
                                    />
                                    <div className="hidden group-hover:block absolute top-full left-0 z-10 p-2 bg-background border rounded-lg shadow-lg">
                                      <img
                                        src={speaker.photo}
                                        alt="Speaker preview"
                                        className="max-h-32 w-auto object-contain"
                                      />
                                    </div>
                                  </div>
                                )}
                              </td>
                              <td className="p-3 max-w-[200px] truncate">
                                <Highlight text={speaker.session || ''} highlight={searchQuery} />
                              </td>
                              <td className="p-3"><Highlight text={speaker.dayTime || ''} highlight={searchQuery} /></td>
                              {/* Removed Bio data cell */}
                              <td className="p-3">
                                {speaker.categories && speaker.categories.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {speaker.categories.map((category, index) => (
                                      <span
                                        key={index}
                                        className="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded"
                                      >
                                        <Highlight text={category} highlight={searchQuery} />
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="p-3 text-right">
                                <div className="flex justify-end gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => {
                                      setEditingSpeaker(speaker);
                                      speakerForm.reset({
                                        assistant_id: selectedAssistant._id!,
                                        name: speaker.name,
                                        title: speaker.title,
                                        company: speaker.company,
                                        photo: speaker.photo,
                                        session: speaker.session,
                                        dayTime: speaker.dayTime,
                                        bio: speaker.bio,
                                        categories: speaker.categories || [],
                                      });
                                      setShowSpeakerModal(true);
                                    }}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="icon"
                                    onClick={() => setSpeakerToDelete(speaker._id || null)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                  {/* Add Info button */}
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => {
                                      setSelectedSpeakerDetails(speaker);
                                      setShowSpeakerDetailsModal(true);
                                    }}
                                  >
                                    <Info className="h-4 w-4" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="text-center p-8 border rounded-lg bg-muted/10">
                    <p className="text-muted-foreground">No results found for "{searchQuery}".</p>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="text-center p-8 border rounded-lg bg-muted/10">
            <p className="text-muted-foreground">No speakers found.</p>
          </div>
        )}
      </div>

      <AlertDialog open={!!speakerToDelete} onOpenChange={(open) => {
        if (!open) {
          setSpeakerToDelete(null);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              speaker and remove their data from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => speakerToDelete && handleDeleteSpeaker(speakerToDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showSpeakerDetailsModal} onOpenChange={setShowSpeakerDetailsModal}>
        <DialogContent className="max-w-4xl w-full p-0 bg-transparent shadow-none rounded-2xl overflow-hidden">
          {selectedSpeakerDetails && (
            <div className="bg-white dark:bg-zinc-900 shadow-xl flex flex-col md:flex-row h-full">
              {/* Left Panel: Image and (on mobile) name/title/company */}
              <div className="w-full md:w-auto md:flex-[0_0_30%] flex flex-col items-center justify-start bg-gradient-to-br from-[#0097B2] to-[#003E49] p-6 md:p-8 min-h-[300px]">
                <div className="text-left w-full flex flex-col gap-4">
                  <div>
                    <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Photo</div>
                    {selectedSpeakerDetails.photo && isImageUrl(selectedSpeakerDetails.photo) ? (
                      <img
                        src={selectedSpeakerDetails.photo}
                        alt="Speaker Photo"
                        className="h-32 w-32 md:h-48 md:w-48 object-cover rounded-xl border-4 border-white shadow-lg bg-white dark:bg-zinc-800"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div className="h-32 w-32 md:h-48 md:w-48 flex items-center justify-center bg-zinc-200 dark:bg-zinc-800 rounded-xl text-zinc-400 text-5xl">
                        <span className="material-icons">Null</span>
                      </div>
                    )}
                  </div>
                  {/* Speaker name, title, company block (always below image) */}
                  <div>
                    <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Name</div>
                    <div className="text-sm font-semibold text-white leading-tight">{selectedSpeakerDetails.name}</div>
                  </div>
                  <div>
                    <div className="text-xm font-semibold text-zinc-900 uppercase tracking-wider mb-1">Title</div>
                    <div className="text-sm font-semibold text-white leading-tight">{selectedSpeakerDetails.title || "Null"}</div>
                  </div>
                  <div>
                    <div className="text-xm font-semibold text-zinc-900 uppercase tracking-wider mb-1">Company</div>
                    <div className="text-sm font-semibold text-white leading-tight">{selectedSpeakerDetails.company || "Null"}</div>
                  </div>
                </div>
              </div>
              {/* Details Section */}
              <div className="w-full md:flex-[0_0_70%] p-6 md:p-8 flex flex-col gap-6 overflow-y-auto max-h-[90vh] md:max-h-[80vh]">
                {/* Speaker Details Heading */}
                <div>
                  <h2 className="text-2xl font-bold text-zinc-900 dark:text-white text-center">Speaker Details</h2>
                </div>
                {/* Session */}
                <div>
                  <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Session</div>
                  <div className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-line">{selectedSpeakerDetails.session || "Null"}</div>
                </div>
                {/* Day & Time */}
                <div>
                  <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Day & Time</div>
                  <div className="flex flex-col gap-1">
                    {(selectedSpeakerDetails.dayTime || "Null").split("/").map((slot, idx) => (
                      <span key={idx} className="text-sm text-zinc-700 dark:text-zinc-200">{slot.trim()}</span>
                    ))}
                  </div>
                </div>
                {/* Bio */}
                <div>
                  <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Bio</div>
                  <div className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-line max-h-40 overflow-y-auto pr-1">{selectedSpeakerDetails.bio || "Null"}</div>
                </div>
                {/* Categories */}
                <div>
                  <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Categories</div>
                  {selectedSpeakerDetails.categories && selectedSpeakerDetails.categories.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedSpeakerDetails.categories.map((category, i) => (
                        <span key={i} className="px-3 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs font-semibold shadow-sm">{category}</span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">Null</span>
                  )}
                </div>
                {/* Photo URL */}
                {selectedSpeakerDetails.photo && (
                  <div className="mt-2">
                    <a
                      href={selectedSpeakerDetails.photo}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300 break-all"
                    >
                      {selectedSpeakerDetails.photo}
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section >
  );
}