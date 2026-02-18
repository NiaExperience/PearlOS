import { toast } from "@dashboard/hooks/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeywordMemory as IKeywordMemory, KeywordMemorySchema, KeywordMemoryCategory } from '../../types/assistant-content/keyword-memory';
import { ChevronDown, Pencil, PlusCircle, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTrigger } from "../ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { IAssistant } from '@nia/prism/core/blocks/assistant.block';
import { ITool } from '@nia/prism/core/blocks/tool.block';

interface MemoryKeywordsSectionProps {
  selectedAssistant: IAssistant;
  keywordTool?: ITool;
}

const Highlight = ({ text, highlight }: { text: string; highlight: string }) => {
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

export default function MemoryKeywordsSection({
  selectedAssistant,
  keywordTool,
}: MemoryKeywordsSectionProps) {
  const [keywords, setKeywords] = useState<IKeywordMemory[]>([]);
  const [showKeywordModal, setShowKeywordModal] = useState(false);
  const [editingKeyword, setEditingKeyword] = useState<IKeywordMemory | null>(null);
  const [keywordToDelete, setKeywordToDelete] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    keywords: false,
  });
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [filteredKeywords, setFilteredKeywords] = useState<IKeywordMemory[]>([]);
  const [searchMatches, setSearchMatches] = useState<{ rowIndex: number; cellIndex: number }[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const keywordForm = useForm({
    resolver: zodResolver(KeywordMemorySchema),
    mode: "onSubmit",
    defaultValues: {
      assistant_id: selectedAssistant._id!,
      keyword: "",
      description: "",
      category: KeywordMemoryCategory.GENERAL,
    },
  });

  useEffect(() => {
    if (!keywordTool) return;
    
    const fetchKeywords = async () => {
      setIsLoading(true);
      try {
        const result = await fetch(`/api/contentList/keywordMemory/${selectedAssistant._id}`);
        if (result.ok) {
          const data = await result.json();
          setKeywords(data as IKeywordMemory[]);
        }
      } catch (error) {
        console.error("Error fetching keywords:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchKeywords();
  }, [selectedAssistant._id, keywordTool]);

  useEffect(() => {
    if (!searchQuery) {
      setFilteredKeywords(keywords);
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }

    const lowercasedQuery = searchQuery.toLowerCase();
    const newFilteredKeywords = keywords.filter(
      (item) =>
        item.keyword.toLowerCase().includes(lowercasedQuery) ||
        item.description.toLowerCase().includes(lowercasedQuery) ||
        (item.category && item.category.toLowerCase().includes(lowercasedQuery))
    );
    setFilteredKeywords(newFilteredKeywords);

    const newMatches: { rowIndex: number; cellIndex: number }[] = [];
    newFilteredKeywords.forEach((item, rowIndex) => {
      if (item.keyword.toLowerCase().includes(lowercasedQuery)) {
        newMatches.push({ rowIndex, cellIndex: 0 });
      }
      if (item.description.toLowerCase().includes(lowercasedQuery)) {
        newMatches.push({ rowIndex, cellIndex: 1 });
      }
      if (item.category && item.category.toLowerCase().includes(lowercasedQuery)) {
        newMatches.push({ rowIndex, cellIndex: 2 });
      }
    });
    setSearchMatches(newMatches);
    setCurrentMatchIndex(newMatches.length > 0 ? 0 : -1);
  }, [searchQuery, keywords]);

  useEffect(() => {
    if (currentMatchIndex !== -1 && searchMatches.length > 0) {
      const { rowIndex } = searchMatches[currentMatchIndex];
      rowRefs.current[rowIndex]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [currentMatchIndex, searchMatches]);

  const handleEditKeyword = async (data: any) => {
    try {
      const result = await fetch(`/api/contentDetail/keywordMemory/${editingKeyword?._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      if (result.ok) {
        const updatedKeywords = await fetch(`/api/contentList/keywordMemory/${selectedAssistant._id}`);
        if (updatedKeywords.ok) {
          const data = await updatedKeywords.json();
          setKeywords(data as IKeywordMemory[]);
        }
        setEditingKeyword(null);
        setShowKeywordModal(false);
        keywordForm.reset();
        toast({
          title: "Success",
          description: "Keyword updated successfully",
        });
      }
    } catch (error) {
      console.error("Error updating keyword:", error);
      toast({
        title: "Error",
        description: "Failed to update keyword",
        variant: "destructive",
      });
    }
  };

  const handleDeleteKeyword = async (keywordId: string) => {
    try {
      const result = await fetch(`/api/contentDetail/keywordMemory/${keywordId}`, {
        method: 'DELETE',
      });
      if (result.ok) {
        const updatedKeywords = await fetch(`/api/contentList/keywordMemory/${selectedAssistant._id}`);
        if (updatedKeywords.ok) {
          const data = await updatedKeywords.json();
          setKeywords(data as IKeywordMemory[]);
        }
        setKeywordToDelete(null);
        toast({
          title: "Success",
          description: "Keyword deleted successfully",
        });
      }
    } catch (error) {
      console.error("Error deleting keyword:", error);
      toast({
        title: "Error",
        description: "Failed to delete keyword",
        variant: "destructive",
      });
    }
  };

  const handleFormSubmit = async (data: any) => {
    try {
      let result;
      if (editingKeyword) {
        result = await fetch(`/api/contentDetail/keywordMemory/${editingKeyword._id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        });
      } else {
        result = await fetch(`/api/contentList/keywordMemory/${selectedAssistant._id}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...data, assistant_id: selectedAssistant._id! }),
        });
      }
      if (result.ok) {
        const updatedKeywords = await fetch(`/api/contentList/keywordMemory/${selectedAssistant._id}`);
        if (updatedKeywords.ok) {
          const data = await updatedKeywords.json();
          setKeywords(data as IKeywordMemory[]);
        }
        setShowKeywordModal(false);
        setEditingKeyword(null);
        keywordForm.reset();
        toast({
          title: "Success",
          description: editingKeyword ? "Keyword updated successfully" : "Keyword created successfully",
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

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

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

  return (
    <>
      {keywordTool && (
        <div className="space-y-6 w-full">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Memory Keywords</h2>
              <p className="text-sm text-muted-foreground">
                Manage memory keywords for your assistant.
              </p>
            </div>
            <Button type="button" variant="ghost" onClick={() => toggleSection('keywords')} className="p-2">
              <ChevronDown className={`h-4 w-4 transition-transform ${collapsedSections.keywords ? 'rotate-180' : ''}`} />
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <PlusCircle className="h-4 w-4 mr-2" />
                  Add Keyword
                </Button>
              </DialogTrigger>
              <DialogContent>
                <h2 className="text-lg font-semibold mb-4">
                  {editingKeyword ? "Edit Keyword" : "Add Keyword"}
                </h2>
                <Form {...keywordForm}>
                  <form onSubmit={keywordForm.handleSubmit(handleFormSubmit)} className="space-y-4">
                    <FormField
                      control={keywordForm.control}
                      name="keyword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Keyword</FormLabel>
                          <FormControl>
                            <Input placeholder="Keyword" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={keywordForm.control}
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
                      control={keywordForm.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <FormControl>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select category" />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.values(KeywordMemoryCategory).map((cat) => (
                                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full">
                      {editingKeyword ? "Update Keyword" : "Add Keyword"}
                    </Button>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
          {!collapsedSections.keywords && (
            <div className="border rounded-lg overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full table-fixed">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium w-[20%]">Keyword</th>
                    <th className="text-left p-3 font-medium w-[40%]">Description</th>
                    <th className="text-left p-3 font-medium w-[20%]">Category</th>
                    <th className="text-right p-3 font-medium w-[20%]">Actions</th>
                  </tr>
                </thead>
                <tbody ref={rowRefs as any}>
                  {filteredKeywords.map((item, rowIndex) => (
                    <tr key={item._id as string} className="border-b">
                      <td className="p-3">
                        <Highlight text={item.keyword as string} highlight={searchQuery} />
                      </td>
                      <td className="p-3">
                        <Highlight text={item.description as string} highlight={searchQuery} />
                      </td>
                      <td className="p-3">
                        <Highlight text={String(item.category)} highlight={searchQuery} />
                      </td>
                      <td className="p-3 text-right">
                        <Button variant="outline" size="sm" onClick={() => {
                          setEditingKeyword(item);
                          keywordForm.reset({
                            ...item,
                            category: item.category as KeywordMemoryCategory,
                          });
                          setShowKeywordModal(true);
                        }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setKeywordToDelete(item._id as string)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AlertDialog open={!!keywordToDelete} onOpenChange={() => setKeywordToDelete(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the keyword.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => keywordToDelete && handleDeleteKeyword(keywordToDelete)}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </>
  );
} 