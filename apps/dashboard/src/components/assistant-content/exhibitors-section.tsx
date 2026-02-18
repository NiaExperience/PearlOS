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
import { toast } from "@dashboard/hooks/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { IAssistant } from '@nia/prism/core/blocks/assistant.block';
import { ITool } from '@nia/prism/core/blocks/tool.block';
import { Exhibitor as IExhibitor, ExhibitorSchema } from '../../types/assistant-content/exhibitor';
import { ChevronDown, Info, Pencil, PlusCircle, Search, Trash2 } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";


interface ExhibitorsSectionProps {
  selectedAssistant: IAssistant;
  exhibitorTool?: ITool;
}

const isImageUrl = (url: string | undefined) => {
  if (!url) return false;
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
};

interface ExhibitorFormData {
  assistant_id: string;
  title: string;
  location: string;
  category: string;
  description: string;
  tellMeMore: string;
  logo: string;
  exTags: string[];
}

export default function ExhibitorsSection({
  selectedAssistant,
  exhibitorTool,
}: ExhibitorsSectionProps) {
  const [exhibitors, setExhibitors] = useState<IExhibitor[]>([]);
  const [showExhibitorModal, setShowExhibitorModal] = useState(false);
  const [showExhibitorDetailsModal, setShowExhibitorDetailsModal] = useState(false);
  const [editingExhibitor, setEditingExhibitor] =
    useState<IExhibitor | null>(null);
  const [selectedExhibitorDetails, setSelectedExhibitorDetails] = useState<IExhibitor | null>(null);
  const [exhibitorToDelete, setExhibitorToDelete] = useState<string | null>(
    null
  );
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({
    exhibitors: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);


  const exhibitorForm = useForm({
    resolver: zodResolver(ExhibitorSchema),
    mode: "onSubmit",
    defaultValues: {
      assistant_id: selectedAssistant._id!,
      title: "",
      location: "",
      category: "",
      description: "",
      tellMeMore: "",
      logo: "",
      exTags: [] as string[],
    },
  });

  useEffect(() => {
    if (!exhibitorTool) return;

    const fetchExhibitors = async () => {
      setIsLoading(true);
      try {
        const result = await fetch(`/api/contentList?assistantId=${selectedAssistant._id}&type=exhibitor`);
        if (result.ok) {
          const data = await result.json();
          setExhibitors(data.items || []);
        }
      } catch (error) {
        console.error("Error fetching exhibitors:", error);
        toast({
          title: "Error",
          description: "Failed to fetch exhibitors.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchExhibitors();
  }, [selectedAssistant._id, exhibitorTool]);

  const filteredExhibitors = exhibitors.filter((item) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const tagsString = Array.isArray(item.exTags)
      ? item.exTags.join(" ").toLowerCase()
      : "";

    return (
      (item.title && item.title.toLowerCase().includes(term)) ||
      (item.location && item.location.toLowerCase().includes(term)) ||
      (item.category && item.category.toLowerCase().includes(term)) ||
      (item.description && item.description.toLowerCase().includes(term)) ||
      (item.tellMeMore && item.tellMeMore.toLowerCase().includes(term)) ||
      (tagsString && tagsString.includes(term))
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
      match.style.backgroundColor = index === newMatchIndex ? "orange" : "yellow";
      match.style.color = "black";
      match.setAttribute("data-match-styled", "true");
    });

    if (allMatches.length > 0 && allMatches[newMatchIndex]) {
      allMatches[newMatchIndex].scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [searchTerm, matchIndex, filteredExhibitors]);

  const handlePrevMatch = () => {
    setMatchIndex((prev) => (prev > 0 ? prev - 1 : matchCount - 1));
  };

  const handleNextMatch = () => {
    setMatchIndex((prev) => (prev < matchCount - 1 ? prev + 1 : 0));
  };

  const handleFormSubmit = async (data: ExhibitorFormData) => {
    try {
      const result = editingExhibitor
        ? await fetch(`/api/contentDetail/${editingExhibitor._id}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
          })
        : await fetch(`/api/contentList?assistantId=${selectedAssistant._id}&type=exhibitor`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
          });

      if (result.ok) {
        const updatedExhibitors = await fetch(`/api/contentList?assistantId=${selectedAssistant._id}&type=exhibitor`);
        if (updatedExhibitors.ok) {
          const data = await updatedExhibitors.json();
          setExhibitors(data.items || []);
        }
        setShowExhibitorModal(false);
        exhibitorForm.reset({
          assistant_id: selectedAssistant._id!,
          title: "",
          location: "",
          category: "",
          description: "",
          tellMeMore: "",
          logo: "",
          exTags: [],
        });
        toast({
          title: "Success",
          description: `Exhibitor ${editingExhibitor ? "updated" : "created"
            } successfully`,
        });
      }
    } catch (error) {
      console.error("Error saving exhibitor:", error);
      toast({
        title: "Error",
        description: `Failed to ${editingExhibitor ? "update" : "create"
          } exhibitor`,
        variant: "destructive",
      });
    }
  };

  const handleDeleteExhibitor = async (exhibitorId: string) => {
    try {
      const result = await fetch(`/api/contentDetail/${exhibitorId}`, {
        method: "DELETE",
      });
      if (result.ok) {
        const updatedExhibitors = await fetch(`/api/contentList?assistantId=${selectedAssistant._id}&type=exhibitor`);
        if (updatedExhibitors.ok) {
          const data = await updatedExhibitors.json();
          setExhibitors(data.items || []);
        }
        setExhibitorToDelete(null);
        toast({
          title: "Success",
          description: "Exhibitor deleted successfully",
        });
      }
    } catch (error: unknown) {
      console.error("Error deleting exhibitor:", error);
      toast({
        title: "Error",
        description: "Failed to delete exhibitor",
        variant: "destructive",
      });
    }
  };

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleShowExhibitorDetails = (exhibitor: IExhibitor) => {
    setSelectedExhibitorDetails(exhibitor);
    setShowExhibitorDetailsModal(true);
  };

  return (
    <>
      {exhibitorTool && (
        <div className="space-y-6 w-full">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Exhibitors</h2>
              <p className="text-sm text-muted-foreground">
                Manage event exhibitors and their information.
              </p>
            </div>
            <Dialog
              open={showExhibitorModal}
              onOpenChange={(open) => {
                if (!open) {
                  exhibitorForm.reset();
                  setEditingExhibitor(null);
                }
                setShowExhibitorModal(open);
              }}
            >
              <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-[#0097B2] to-[#003E49] hover:from-[#008299] hover:to-[#00313A] text-white">
                  Add Exhibitor
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogTitle className="text-lg font-semibold mb-4">
                  {editingExhibitor ? "Edit Exhibitor" : "Create Exhibitor"}
                </DialogTitle>
                <Form {...exhibitorForm}>
                  <form
                    className="space-y-4"
                    onSubmit={exhibitorForm.handleSubmit(handleFormSubmit)}
                  >
                    <FormField
                      control={exhibitorForm.control}
                      name="title"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Title</FormLabel>
                          <FormControl>
                            <Input placeholder="Exhibitor title" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={exhibitorForm.control}
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
                      control={exhibitorForm.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <FormControl>
                            <Input placeholder="Category" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={exhibitorForm.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <Input placeholder="Description" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={exhibitorForm.control}
                      name="logo"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Logo URL</FormLabel>
                          <FormControl>
                            <Input placeholder="Logo URL" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={exhibitorForm.control}
                      name="tellMeMore"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tell Me More URL</FormLabel>
                          <FormControl>
                            <Input placeholder="More Info URL" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={exhibitorForm.control}
                      name="exTags"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tags</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Enter Tags separated by commas"
                              value={
                                Array.isArray(field.value) ? field.value.join(", ") : ""
                              }
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

                    <Button type="submit" className="w-full">
                      {editingExhibitor ? "Update Exhibitor" : "Create Exhibitor"}
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
                placeholder="Search exhibitors..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-full"
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
              <p>Loading exhibitors...</p>
            </div>
          ) : exhibitors.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Exhibitors</h2>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => toggleSection("exhibitors")}
                    className="p-2"
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${collapsedSections.exhibitors ? "rotate-180" : ""
                        }`}
                    />
                  </Button>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        <PlusCircle className="h-4 w-4 mr-2" />
                        Expand
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogTitle>Expanded Exhibitors List</DialogTitle>
                      {/* Content for the expanded view can go here */}
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
              {!collapsedSections.exhibitors && (
                <div className="border rounded-lg overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full table-fixed">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 font-medium w-[20%]">
                          Title
                        </th>
                        <th className="text-left p-3 font-medium w-[200px]">
                          Location
                        </th>
                        <th className="text-left p-3 font-medium w-[200px]">
                          Category
                        </th>
                        <th className="text-left p-3 font-medium w-[200px]">
                          Logo
                        </th>
                        <th className="text-left p-3 font-medium w-[200px]">
                          Tags
                        </th>
                        <th className="text-right p-3 font-medium w-[100px]">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody ref={tableBodyRef}>
                      {filteredExhibitors.map((exhibitor, index) => (
                        <tr
                          key={exhibitor._id as React.Key}
                          className={
                            index % 2 === 0 ? "bg-background" : "bg-muted/30"
                          }
                        >
                          <td className="p-3">
                            {getHighlightedText(exhibitor.title, searchTerm)}
                          </td>
                          <td className="p-3">
                            {getHighlightedText(exhibitor.location, searchTerm)}
                          </td>
                          <td className="p-3">
                            {getHighlightedText(exhibitor.category, searchTerm)}
                          </td>
                          <td className="p-3">
                            <a
                              href={exhibitor.logo}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                            >
                              <span className="truncate max-w-[200px] inline-block">
                                {getHighlightedText(exhibitor.logo, searchTerm)}
                              </span>
                            </a>
                            {isImageUrl(exhibitor.logo) && (
                              <div className="relative group mt-2">
                                <img
                                  src={exhibitor.logo}
                                  alt="Exhibitor logo preview"
                                  className="h-12 w-12 object-cover rounded-md border"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.onerror = null;
                                    target.style.display = "none";
                                  }}
                                />
                                <div className="hidden group-hover:block absolute top-full left-0 z-10 p-2 bg-background border rounded-lg shadow-lg">
                                  <img
                                    src={exhibitor.logo}
                                    alt="Exhibitor logo preview"
                                    className="max-h-32 w-auto object-contain"
                                  />
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="p-3">
                            {exhibitor.exTags && exhibitor.exTags.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {exhibitor.exTags.map((exTag: string, i: number) => (
                                  <span
                                    key={i}
                                    className="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded"
                                  >
                                    {getHighlightedText(exTag, searchTerm)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>

                          <td className="p-3">
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => {
                                  setEditingExhibitor(exhibitor);
                                  exhibitorForm.reset({
                                    ...exhibitor,
                                    assistant_id: selectedAssistant._id || '',
                                    exTags: exhibitor.exTags || [],
                                  });
                                  setShowExhibitorModal(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="icon"
                                onClick={() =>
                                  setExhibitorToDelete(exhibitor._id as string)
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => handleShowExhibitorDetails(exhibitor)}
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
              )}
            </div>
          ) : (
            <div className="text-center p-8 border rounded-lg bg-muted/10">
              <p className="text-muted-foreground">No exhibitors found.</p>
            </div>
          )}

          <AlertDialog
            open={!!exhibitorToDelete}
            onOpenChange={() => setExhibitorToDelete(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the
                  exhibitor.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    exhibitorToDelete && handleDeleteExhibitor(exhibitorToDelete)
                  }
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Dialog open={showExhibitorDetailsModal} onOpenChange={setShowExhibitorDetailsModal}>
            <DialogContent className="max-w-4xl w-full p-0 bg-transparent shadow-none rounded-2xl overflow-hidden">
              {selectedExhibitorDetails && (
                <>
                  {/* Exhibitor Details Heading */}
                  <div className="bg-white dark:bg-zinc-900 shadow-xl flex flex-col md:flex-row h-full">
                    {/* Left Panel: Key Info */}
                    <div className="w-full md:w-auto md:flex-[0_0_30%] flex flex-col items-center justify-start bg-gradient-to-br from-[#0097B2] to-[#003E49] p-6 md:p-8 min-h-[300px]">
                      <div className="text-left w-full flex flex-col gap-4">
                        <div>
                          <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Title</div>
                          <div className="text-sm font-semibold text-white leading-tight">{selectedExhibitorDetails.title || "Null"}</div>
                        </div>
                        <div>
                          <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Category</div>
                          <div className="text-sm font-semibold text-white leading-tight">{selectedExhibitorDetails.category || "Null"}</div>
                        </div>
                        <div>
                          <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Logo</div>
                          {selectedExhibitorDetails.logo && isImageUrl(selectedExhibitorDetails.logo) ? (
                            <img
                              src={selectedExhibitorDetails.logo}
                              alt="Exhibitor Logo"
                              className="h-32 w-32 md:h-32 md:w-32 object-cover rounded-xl border-4 border-white shadow-lg bg-white dark:bg-zinc-800"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          ) : (
                            <span className="text-sm font-semibold text-white leading-tight">Null</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Details Section */}
                    <div className="w-full md:flex-[0_0_70%] p-6 md:p-8 flex flex-col gap-6 overflow-y-auto max-h-[90vh] md:max-h-[80vh]">
                      {/* Exhibitor Details Heading */}
                      <h2 className="text-2xl font-bold text-zinc-900 dark:text-white text-center mb-4">Exhibitor Details</h2>
                      {/* Location */}
                      <div>
                        <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Location</div>
                        <div className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-line">{selectedExhibitorDetails.location || "Null"}</div>
                      </div>
                      {/* Description */}
                      <div>
                        <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Description</div>
                        <div className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-line">{selectedExhibitorDetails.description || "Null"}</div>
                      </div>
                      {/* Tags */}
                      <div>
                        <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Tags</div>
                        {selectedExhibitorDetails.exTags && selectedExhibitorDetails.exTags.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {selectedExhibitorDetails.exTags.map((tag: string, i: number) => (
                              <span key={i} className="px-3 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs font-semibold shadow-sm">{tag}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm text-zinc-500 dark:text-zinc-400">Null</span>
                        )}
                      </div>
                      {/* Tell Me More URL */}
                      <div>
                        <div className="text-xm font-semibold text-zinc-900 uppercase mb-1 tracking-wider">Tell Me More URL</div>
                        {selectedExhibitorDetails.tellMeMore ? (
                          <a
                            href={selectedExhibitorDetails.tellMeMore}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300 break-all"
                          >
                            {selectedExhibitorDetails.tellMeMore}
                          </a>
                        ) : (
                          <span className="text-sm text-zinc-500 dark:text-zinc-400">Null</span>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}
    </>
  );
} 