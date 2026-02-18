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
import { Badge } from "@dashboard/components/ui/badge";
import { Button } from "@dashboard/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@dashboard/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@dashboard/components/ui/form";
import { Input } from "@dashboard/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/components/ui/select";
import { Textarea } from "@dashboard/components/ui/textarea";
import { toast } from "@dashboard/hooks/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Info, Pencil, PlusCircle, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Agenda, AgendaSchema } from '../../types/assistant-content/agenda';
import { IAssistant } from '@nia/prism/core/blocks/assistant.block';

// Use local Agenda type
interface AgendaFormData {
  assistant_id: string;
  track: string;
  title: string;
  dayTime: string;
  location: string;
  type: string;
  description: string;
  speaker: string;
  categories: string[];
  tellMeMore: string;
  [key: string]: unknown; // Add index signature to allow Record<string, unknown>
}

interface AgendaSectionProps {
  selectedAssistant: IAssistant;
}

const isUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
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

export default function AgendaSection({
  selectedAssistant: selectedAssistant,
}: AgendaSectionProps) {
  const [agendaItems, setAgendaItems] = useState<Agenda[]>([]);
  const [showAgendaModal, setShowAgendaModal] = useState(false);
  const [editingAgenda, setEditingAgenda] = useState<Agenda | null>(null);
  const [agendaToDelete, setAgendaToDelete] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({
    agendas: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);
  const [showAgendaDetailsModal, setShowAgendaDetailsModal] = useState(false);
  const [selectedAgendaDetails, setSelectedAgendaDetails] = useState<Agenda | null>(null);

  const agendaForm = useForm<AgendaFormData>({
    resolver: zodResolver(AgendaSchema),
    mode: "onSubmit",
    defaultValues: {
      assistant_id: selectedAssistant._id!,
      track: "",
      title: "",
      dayTime: "",
      location: "",
      type: "",
      description: "",
      speaker: "",
      categories: [] as string[],
      tellMeMore: "",
    },
  });

  // Check if assistant supports this content type
  const contentType = 'Agenda';
  const isSupported = selectedAssistant?.contentTypes?.includes(contentType);

  useEffect(() => {
    if (!isSupported) return;
    setIsLoading(true);
    fetch(`/api/contentList?type=Agenda&assistantId=${selectedAssistant._id}`)
      .then((res) => res.json())
      .then((data) => setAgendaItems(data.items || []))
      .catch((error) => {
        console.error("Error fetching agenda:", error);
        toast({
          title: "Error",
          description: "Failed to fetch agenda.",
          variant: "destructive",
        });
      })
      .finally(() => setIsLoading(false));
  }, [selectedAssistant, isSupported]);

  const filteredAgendaItems = agendaItems.filter((item) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const categoriesString = Array.isArray(item.categories)
      ? item.categories.join(" ").toLowerCase()
      : "";

    return (
      (item.track || '').toLowerCase().includes(term) ||
      (item.title || '').toLowerCase().includes(term) ||
      (item.dayTime || '').toLowerCase().includes(term) ||
      (item.location || '').toLowerCase().includes(term) ||
      (item.type || '').toLowerCase().includes(term) ||
      (item.description || '').toLowerCase().includes(term) ||
      (item.speaker || '').toLowerCase().includes(term) ||
      (item.tellMeMore || '').toLowerCase().includes(term) ||
      (categoriesString && categoriesString.includes(term))
    );
  });

  const getHighlightedText = (text: string | undefined, highlight: string) => {
    if (!highlight.trim() || !text) {
      return <span>{text || ''}</span>;
    }
    const parts = text.split(new RegExp(`(${highlight})`, "gi"));
    return (
      <span>
        {parts.map((part, i) =>
          part.toLowerCase() === highlight.toLowerCase() ? (
            <span key={i} data-match="true">
              {part}
            </span>
          ) : (
            part
          )
        )}
      </span>
    );
  };

  useEffect(() => {
    const tableBody = tableBodyRef.current;
    if (!tableBody || !searchTerm.trim()) {
      tableBody?.querySelectorAll('[data-match-styled="true"]').forEach((el) => {
        const match = el as HTMLElement;
        match.style.backgroundColor = "";
        match.style.color = "";
        match.removeAttribute("data-match-styled");
      });
      setMatchCount(0);
      setMatchIndex(0);
      return;
    }

    const allMatches = Array.from(
      tableBody.querySelectorAll('[data-match="true"]')
    ) as HTMLElement[];
    setMatchCount(allMatches.length);

    if (allMatches.length === 0) {
      setMatchIndex(0);
      return;
    }

    const newMatchIndex = Math.max(
      0,
      Math.min(matchIndex, allMatches.length - 1)
    );
    if (newMatchIndex !== matchIndex) {
      setMatchIndex(newMatchIndex);
      return;
    }

    allMatches.forEach((match, index) => {
      match.style.backgroundColor = index === newMatchIndex ? "#0097B2" : "yellow";
      match.style.color = "black";
      match.setAttribute("data-match-styled", "true");
    });

    if (allMatches.length > 0 && allMatches[newMatchIndex]) {
      allMatches[newMatchIndex].scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [searchTerm, matchIndex, filteredAgendaItems]);

  const handlePrevMatch = () => {
    setMatchIndex((prev) => (prev > 0 ? prev - 1 : matchCount - 1));
  };

  const handleNextMatch = () => {
    setMatchIndex((prev) => (prev < matchCount - 1 ? prev + 1 : 0));
  };

  const handleDeleteAgenda = async (agendaId: string) => {
    try {
      const res = await fetch(`/api/contentDetail?type=Agenda&assistantId=${selectedAssistant._id}&id=${agendaId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        // Refresh list
        fetch(`/api/contentList?type=Agenda&assistantId=${selectedAssistant._id}`)
          .then((res) => res.json())
          .then((data) => setAgendaItems(data.items || []));
        setAgendaToDelete(null);
        toast({
          title: "Success",
          description: "Agenda item deleted successfully",
        });
      }
    } catch (error) {
      console.error("Error deleting agenda:", error);
      toast({
        title: "Error",
        description: "Failed to delete agenda item",
        variant: "destructive",
      });
    }
  };

  const handleShowAgendaDetails = (agenda: Agenda) => {
    setSelectedAgendaDetails(agenda);
    setShowAgendaDetailsModal(true);
  };

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  if (!isSupported) {
    return <div>This content type is not supported by {selectedAssistant?.name}</div>;
  }

  return (
    <section className="space-y-4">
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold">Agenda</h2>
            <p className="text-sm text-muted-foreground">
              Manage event agenda items and schedule.
            </p>
          </div>
          <Dialog
            open={showAgendaModal}
            onOpenChange={(open) => {
              if (!open) {
                agendaForm.reset({
                  assistant_id: selectedAssistant._id!,
                  track: "",
                  title: "",
                  dayTime: "",
                  location: "",
                  type: "",
                  description: "",
                  speaker: "",
                  categories: [] as string[],
                  tellMeMore: "",
                });
                setEditingAgenda(null);
              }
              setShowAgendaModal(open);
            }}
          >
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-[#0097B2] to-[#003E49] hover:from-[#008299] hover:to-[#00313A] text-white">
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Agenda Item
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>{editingAgenda ? "Edit Agenda Item" : "Create Agenda Item"}</DialogTitle>
              <Form {...agendaForm}>
                <form
                  onSubmit={agendaForm.handleSubmit(async (data) => {
                    try {
                      let res;
                      if (editingAgenda) {
                        res = await fetch(`/api/contentDetail?type=Agenda&assistantId=${selectedAssistant._id}&id=${editingAgenda._id}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(data),
                        });
                      } else {
                        res = await fetch(`/api/contentDetail?type=Agenda&assistantId=${selectedAssistant._id}`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(data),
                        });
                      }
                      if (res.ok) {
                        // Refresh list
                        fetch(`/api/contentList?type=Agenda&assistantId=${selectedAssistant._id}`)
                          .then((res) => res.json())
                          .then((data) => setAgendaItems(data.items || []));
                        setEditingAgenda(null);
                        setShowAgendaModal(false);
                        agendaForm.reset({
                          assistant_id: selectedAssistant._id!,
                          track: "",
                          title: "",
                          dayTime: "",
                          location: "",
                          type: "",
                          description: "",
                          speaker: "",
                          categories: [] as string[],
                          tellMeMore: "",
                        });
                        toast({
                          title: "Success",
                          description: editingAgenda ? "Agenda item updated successfully" : "Agenda item created successfully",
                        });
                      }
                    } catch (error) {
                      console.error("Error saving agenda item:", error);
                      toast({
                        title: "Error",
                        description: "Failed to save agenda item",
                        variant: "destructive",
                      });
                    }
                  })}
                  className="space-y-4"
                >
                  <FormField
                    control={agendaForm.control}
                    name="track"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Track</FormLabel>
                        <FormControl>
                          <Input placeholder="Track" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={agendaForm.control}
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
                    control={agendaForm.control}
                    name="dayTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Day & Time</FormLabel>
                        <FormControl>
                          <Input placeholder="Day & Time" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={agendaForm.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location</FormLabel>
                        <FormControl>
                          <Input placeholder="Location" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={agendaForm.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type</FormLabel>
                        <FormControl>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="session">Session</SelectItem>
                              <SelectItem value="break">Break</SelectItem>
                              <SelectItem value="meal">Meal</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={agendaForm.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Description" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={agendaForm.control}
                    name="speaker"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Speaker</FormLabel>
                        <FormControl>
                          <Input placeholder="Speaker" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={agendaForm.control}
                    name="categories"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Categories</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Comma separated categories"
                            value={field.value?.join(", ") || ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value.split(",").map((s) => s.trim())
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={agendaForm.control}
                    name="tellMeMore"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tell Me More URL</FormLabel>
                        <FormControl>
                          <Input placeholder="https://example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full">
                    {editingAgenda ? "Update Agenda Item" : "Create Agenda Item"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex w-full items-center gap-2">
          <div className="relative flex-grow">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search agenda..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 w-full outline-offset-2 outline-[#0097B2] focus-visible:outline-[#0097B2] focus-visible:ring-0"
            />
            {searchTerm && (
              <div className="absolute right-3 top-2.5 text-sm text-muted-foreground">
                {matchCount > 0 ? `${matchIndex + 1} /` : ""} {matchCount} found
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

        {isLoading ? (
          <div className="flex justify-center items-center h-24">
            <p>Loading agenda items...</p>
          </div>
        ) : agendaItems.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">All Agenda Items</h3>
              <div>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleSection("agendas")}
                    >
                      {collapsedSections.agendas ? "Expand" : "Collapse"}
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${collapsedSections.agendas ? "rotate-180" : ""
                          }`}
                      />
                    </Button>
                  </DialogTrigger>
                </Dialog>
              </div>
            </div>
            {!collapsedSections.agendas && (
              <div className="border rounded-lg overflow-hidden">
                <div className="relative max-h-[calc(100vh-25rem)] overflow-y-auto">
                  <table className="w-full table-fixed">
                    <thead>
                      <tr className="border-b bg-background sticky top-0 z-10">
                        <th className="text-left p-3 font-medium w-[15%]">Track</th>
                        <th className="text-left p-3 font-medium w-[15%]">Title</th>
                        <th className="text-left p-3 font-medium w-[15%]">Day & Time</th>
                        <th className="text-left p-3 font-medium w-[10%]">Location</th>
                        <th className="text-left p-3 font-medium w-[10%]">Type</th>
                        <th className="text-left p-3 font-medium w-[10%]">Speaker</th>
                        <th className="text-left p-3 font-medium w-[10%]">Categories</th>
                        {/* Removed Tell Me More column */}
                        <th className="text-right p-3 font-medium w-[5%]">Actions</th>
                      </tr>
                    </thead>
                    <tbody ref={tableBodyRef}>
                      {filteredAgendaItems.map((item) => (
                        <tr key={item._id} className="border-b last:border-b-0">
                          <td className="p-3">{getHighlightedText(item.track, searchTerm)}</td>
                          <td className="p-3">{getHighlightedText(item.title, searchTerm)}</td>
                          <td className="p-3">{getHighlightedText(item.dayTime, searchTerm)}</td>
                          <td className="p-3">{getHighlightedText(item.location, searchTerm)}</td>
                          <td className="p-3">{getHighlightedText(item.type, searchTerm)}</td>
                          <td className="p-3">{getHighlightedText(item.speaker, searchTerm)}</td>
                          <td className="p-3">
                            {item.categories && item.categories.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {item.categories.map((category, i) => (
                                  <Badge key={i} variant="secondary">
                                    {getHighlightedText(category, searchTerm)}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </td>
                          {/* Removed Tell Me More data cell */}
                          <td className="p-3 text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => {
                                  setEditingAgenda(item);
                                  agendaForm.reset({
                                    assistant_id: selectedAssistant._id!,
                                    track: item.track || "",
                                    title: item.title || "",
                                    dayTime: item.dayTime || "",
                                    location: item.location || "",
                                    type: item.type || "",
                                    description: item.description || "",
                                    speaker: item.speaker || "",
                                    categories: item.categories || [],
                                    tellMeMore: item.tellMeMore || "",
                                  });
                                  setShowAgendaModal(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="icon"
                                onClick={() => setAgendaToDelete(item._id as string)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => handleShowAgendaDetails(item)}
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
            )}
          </div>
        ) : (
          <div className="text-center p-8 border rounded-lg bg-muted/10">
            <p className="text-muted-foreground">No agenda items found.</p>
          </div>
        )}
      </div>

      <AlertDialog open={!!agendaToDelete} onOpenChange={(open) => {
        if (!open) {
          setAgendaToDelete(null);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              agenda item and remove its data from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => agendaToDelete && handleDeleteAgenda(agendaToDelete)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showAgendaDetailsModal} onOpenChange={setShowAgendaDetailsModal}>
        <DialogContent className="max-w-4xl w-full p-0 bg-transparent shadow-none rounded-2xl overflow-hidden">
          {selectedAgendaDetails && (
            <>
              {/* Remove the heading above both panels. Only keep the heading inside the right panel. */}
              <div className="bg-white dark:bg-zinc-900 shadow-xl flex flex-col md:flex-row h-full">
                {/* Left Panel: Key Info */}
                <div className="w-full md:w-auto md:flex-[0_0_30%] flex flex-col items-center justify-start bg-gradient-to-br from-[#0097B2] to-[#003E49] p-6 md:p-8 min-h-[300px]">
                  <div className="text-left w-full flex flex-col gap-4">
                    <div>
                      <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Track</div>
                      <div className="text-sm font-semibold text-white leading-tight">{selectedAgendaDetails.track || "Null"}</div>
                    </div>
                    <div>
                      <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Title</div>
                      <div className="text-sm font-semibold text-white leading-tight">{selectedAgendaDetails.title || "Null"}</div>
                    </div>
                    <div>
                      <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Type</div>
                      <div className="text-sm font-semibold text-white leading-tight">{selectedAgendaDetails.type || "Null"}</div>
                    </div>
                    <div>
                      <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Location</div>
                      <div className="text-sm font-semibold text-white leading-tight">{selectedAgendaDetails.location || "Null"}</div>
                    </div>
                  </div>
                </div>
                {/* Details Section */}
                <div className="w-full md:flex-[0_0_70%] p-6 md:p-8 flex flex-col gap-6 overflow-y-auto max-h-[90vh] md:max-h-[80vh]">
                  {/* Agenda Item Details Heading */}
                  <h2 className="text-2xl font-bold text-zinc-900 dark:text-white text-center mb-4">Agenda Item Details</h2>
                  {/* Day & Time */}
                  <div>
                    <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Day & Time</div>
                    <div className="flex flex-col gap-1">
                      {(selectedAgendaDetails.dayTime || "Null").split("/").map((slot, idx) => (
                        <span key={idx} className="text-sm text-zinc-700 dark:text-zinc-200">{slot.trim()}</span>
                      ))}
                    </div>
                  </div>
                  {/* Description */}
                  <div>
                    <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Description</div>
                    <div className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-line max-h-40 overflow-y-auto pr-1">{selectedAgendaDetails.description || "Null"}</div>
                  </div>
                  {/* Speaker */}
                  <div>
                    <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Speaker</div>
                    <div className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-line">{selectedAgendaDetails.speaker || "Null"}</div>
                  </div>
                  {/* Categories */}
                  <div>
                    <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Categories</div>
                    {selectedAgendaDetails.categories && selectedAgendaDetails.categories.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedAgendaDetails.categories.map((category, i) => (
                          <span key={i} className="px-3 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs font-semibold shadow-sm">{category}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">Null</span>
                    )}
                  </div>
                  {/* Tell Me More URL */}
                  {selectedAgendaDetails.tellMeMore && (
                    <div className="mt-2">
                      <a
                        href={selectedAgendaDetails.tellMeMore}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300 break-all"
                      >
                        {selectedAgendaDetails.tellMeMore}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
} 