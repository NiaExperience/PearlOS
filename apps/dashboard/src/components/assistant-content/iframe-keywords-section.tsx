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
import { IframeKeyword, IframeKeywordSchema } from '../../types/assistant-content/iframe-keywords';
import { ChevronDown, Loader2, Pencil, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { IAssistant } from '@nia/prism/core/blocks/assistant.block';
import { ITool } from '@nia/prism/core/blocks/tool.block';


interface IframeKeywordsSectionProps {
  selectedAssistant: IAssistant;
  iframeKeywordTool?: ITool;
}

export default function IframeKeywordsSection({
  selectedAssistant,
  iframeKeywordTool,
}: IframeKeywordsSectionProps) {
  const [iframeKeywords, setIframeKeywords] = useState<IframeKeyword[]>([]);
  const [showIframeKeywordModal, setShowIframeKeywordModal] = useState(false);
  const [editingIframeKeyword, setEditingIframeKeyword] =
    useState<IframeKeyword | null>(null);
  const [iframeKeywordToDelete, setIframeKeywordToDelete] = useState<
    string | null
  >(null);
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({
    iframeKeywords: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);

  const iframeKeywordForm = useForm({
    resolver: zodResolver(IframeKeywordSchema),
    mode: "onSubmit",
    defaultValues: {
      assistant_id: selectedAssistant._id!,
      name: "",
      url: "",
      description: "",
      keywords: [] as string[],
    },
  });

  useEffect(() => {
    if (!iframeKeywordTool) return;
    
    const fetchIframeKeywords = async () => {
      setIsLoading(true);
      try {
        const result = await fetch(`/api/contentList?type=iframeKeyword&assistantId=${selectedAssistant._id}`);
        if (result.ok) {
          const data = await result.json();
          setIframeKeywords(data);
        }
      } catch (error) {
        console.error("Error fetching IFrame keywords:", error);
        toast({
          title: "Error",
          description: "Failed to fetch IFrame keywords.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchIframeKeywords();
  }, [selectedAssistant._id, iframeKeywordTool]);

  const filteredIframeKeywords = iframeKeywords.filter((item) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const keywordsString = Array.isArray(item.keywords)
      ? item.keywords.join(" ").toLowerCase()
      : "";

    return (
      (item.name && item.name.toLowerCase().includes(term)) ||
      (item.url && item.url.toLowerCase().includes(term)) ||
      (item.description && item.description.toLowerCase().includes(term)) ||
      (keywordsString && keywordsString.includes(term))
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
  }, [searchTerm, matchIndex, filteredIframeKeywords]);

  const handlePrevMatch = () => {
    setMatchIndex((prev) => (prev > 0 ? prev - 1 : matchCount - 1));
  };

  const handleNextMatch = () => {
    setMatchIndex((prev) => (prev < matchCount - 1 ? prev + 1 : 0));
  };

  const handleFormSubmit = async (data: any) => {
    try {
      let result;
      const keywordData = {
        ...data,
        assistant_id: selectedAssistant._id!,
        keywords: data.keywords.filter((k: string) => k.length > 0),
      };

      if (keywordData.keywords.length === 0) {
        toast({
          title: "Error",
          description: "At least one keyword is required",
          variant: "destructive",
        });
        return;
      }

      if (editingIframeKeyword) {
        result = await fetch(`/api/contentDetail/${editingIframeKeyword._id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(keywordData),
        });
      } else {
        result = await fetch(`/api/contentList?type=iframeKeyword&assistantId=${selectedAssistant._id}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(keywordData),
        });
      }

      if (result.ok) {
        const updated = await fetch(`/api/contentList?type=iframeKeyword&assistantId=${selectedAssistant._id}`);
        const data = await updated.json();
        setIframeKeywords(data);
        iframeKeywordForm.reset();
        setShowIframeKeywordModal(false);
        setEditingIframeKeyword(null);
        toast({
          title: "Success",
          description: `Keyword ${
            editingIframeKeyword ? "updated" : "created"
          } successfully`,
        });
      } else {
        const errorData = await result.json();
        toast({
          title: "Error",
          description: errorData.error || "Failed to save keyword",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error saving keyword:", error);
      toast({
        title: "Error",
        description: "Failed to save keyword",
        variant: "destructive",
      });
    }
  };

  const handleDeleteIframeKeyword = async (keywordId: string) => {
    try {
      const result = await fetch(`/api/contentDetail/${keywordId}`, {
        method: 'DELETE',
      });
      if (result.ok) {
        const updatedIframeKeywords = await fetch(`/api/contentList?type=iframeKeyword&assistantId=${selectedAssistant._id}`);
        const data = await updatedIframeKeywords.json();
        setIframeKeywords(data);
        setIframeKeywordToDelete(null);
        toast({
          title: "Success",
          description: "Keyword deleted successfully",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete keyword",
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

  return (
    <>
      {iframeKeywordTool && (
        <div className="space-y-6 w-full">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Iframe Keywords</h2>
              <p className="text-sm text-muted-foreground">
                Manage keywords for content optimization
              </p>
            </div>
            <Dialog
              open={showIframeKeywordModal}
              onOpenChange={(open) => {
                if (!open) {
                  iframeKeywordForm.reset();
                  setEditingIframeKeyword(null);
                }
                setShowIframeKeywordModal(open);
              }}
            >
              <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-[#0097B2] to-[#003E49] hover:from-[#008299] hover:to-[#00313A] text-white">
                  Add Iframe Keyword
                </Button>
              </DialogTrigger>
              <DialogContent>
                <h2 className="text-lg font-semibold mb-4">
                  {editingIframeKeyword ? "Edit Keyword" : "Add Keyword"}
                </h2>
                <Form {...iframeKeywordForm}>
                  <form
                    className="space-y-4"
                    onSubmit={iframeKeywordForm.handleSubmit(handleFormSubmit)}
                  >
                    <FormField
                      control={iframeKeywordForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Keyword name" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={iframeKeywordForm.control}
                      name="url"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>URL</FormLabel>
                          <FormControl>
                            <Input placeholder="https://example.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={iframeKeywordForm.control}
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
                      control={iframeKeywordForm.control}
                      name="keywords"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Keywords</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Enter keywords separated by commas"
                              value={Array.isArray(field.value) ? field.value.join(", ") : ""}
                              onChange={(e) => {
                                const keywords = e.target.value
                                  .split(",")
                                  .map((k) => k.trim())
                                  .filter((k) => k.length > 0);
                                field.onChange(keywords);
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="flex justify-end space-x-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setShowIframeKeywordModal(false);
                          setEditingIframeKeyword(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button type="submit">
                        {editingIframeKeyword ? "Update Keyword" : "Create Keyword"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search keywords..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
              />
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <>
                {filteredIframeKeywords.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleSection("iframeKeywords")}
                          className="p-0 h-auto"
                        >
                          <ChevronDown
                            className={`h-4 w-4 transition-transform ${
                              collapsedSections.iframeKeywords ? "rotate-180" : ""
                            }`}
                          />
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          {filteredIframeKeywords.length} keywords
                        </span>
                      </div>
                    </div>
                    {!collapsedSections.iframeKeywords && (
                      <div className="border rounded-lg overflow-hidden">
                        <table className="w-full">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="text-left p-3 font-medium">Name</th>
                              <th className="text-left p-3 font-medium">URL</th>
                              <th className="text-left p-3 font-medium">Description</th>
                              <th className="text-left p-3 font-medium">Keywords</th>
                              <th className="text-right p-3 font-medium">Actions</th>
                            </tr>
                          </thead>
                          <tbody ref={tableBodyRef}>
                            {filteredIframeKeywords.map((keyword) => (
                              <tr
                                key={keyword._id || 'temp-key'}
                                className="border-b bg-background"
                              >
                                <td className="p-3">
                                  {getHighlightedText(keyword.name, searchTerm)}
                                </td>
                                <td className="p-3">
                                  <a
                                    href={keyword.url || '#'}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline"
                                  >
                                    {getHighlightedText(keyword.url || '', searchTerm)}
                                  </a>
                                </td>
                                <td className="p-3">
                                  {getHighlightedText(
                                    keyword.description || "",
                                    searchTerm
                                  )}
                                </td>
                                <td className="p-3">
                                  <div className="flex flex-wrap gap-1">
                                    {keyword.keywords.map((k: string, i: number) => (
                                      <Badge key={i} variant="secondary">
                                        {getHighlightedText(k, searchTerm)}
                                      </Badge>
                                    ))}
                                  </div>
                                </td>
                                <td className="p-3">
                                  <div className="flex gap-2 justify-end">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      onClick={() => {
                                        setEditingIframeKeyword(keyword);
                                        iframeKeywordForm.reset({
                                          ...keyword,
                                          assistant_id:
                                            selectedAssistant._id!,
                                          keywords: keyword.keywords || [],
                                        });
                                        setShowIframeKeywordModal(true);
                                      }}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="destructive"
                                      size="icon"
                                      onClick={() =>
                                        setIframeKeywordToDelete(
                                          keyword._id || null
                                        )
                                      }
                                    >
                                      <Trash2 className="h-4 w-4" />
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
                    <p className="text-muted-foreground">
                      No IFrame keywords found.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <AlertDialog
        open={!!iframeKeywordToDelete}
        onOpenChange={() => setIframeKeywordToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the keyword and its associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (iframeKeywordToDelete) {
                  handleDeleteIframeKeyword(iframeKeywordToDelete);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
} 