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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/components/ui/select";
import { toast } from "@dashboard/hooks/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { ITool } from "@nia/prism/core/blocks/tool.block";
import { IAssistant } from "@nia/prism/core/blocks/assistant.block";
import { Activity as IActivity, ActivitySchema } from '../../types/assistant-content/activity';
import { Pencil, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";


interface ActivityFormData {
  assistant_id: string;
  excursion_name: string;
  time: string;
  description: string;
  location: string;
  photo_url: string;
  is_active: boolean;
  category: string;
  client_code: string;
}

interface ActivitySectionProps {
  selectedAssistant: IAssistant;
  activityTool?: ITool;
}

export default function ActivitySection({
  selectedAssistant,
  activityTool,
}: ActivitySectionProps) {
  const [activities, setActivities] = useState<IActivity[]>([]);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [editingActivity, setEditingActivity] = useState<IActivity | null>(
    null
  );
  const [activityToDelete, setActivityToDelete] = useState<string | null>(null);
  const [activityCategories, setActivityCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);

  const activityForm = useForm({
    resolver: zodResolver(ActivitySchema),
    mode: "onSubmit",
    defaultValues: {
      assistant_id: selectedAssistant._id!,
      excursion_name: "",
      time: "",
      description: "",
      location: "",
      photo_url: "",
      is_active: true,
      category: "",
      client_code: "",
    },
  });

  useEffect(() => {
    if (!activityTool) return;
    
    const fetchActivities = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/contentList/activity/${selectedAssistant._id}`);
        if (response.ok) {
          const result = await response.json();
          if (result?.success && result.data) {
            setActivities(result.data);
            // Extract unique categories
            const categories = result.data
              .map((activity: IActivity) => activity.category)
              .filter((category: string) => category && category.trim() !== "")
              .filter(
                (value: string, index: number, self: string[]) =>
                  self.indexOf(value) === index
              );
            setActivityCategories(categories);
            // Reset selected category
            setSelectedCategory(null);
          }
        } else {
          throw new Error("Failed to fetch activities");
        }
      } catch (error) {
        console.error("Error fetching activities:", error);
        toast({
          title: "Error",
          description: "Failed to fetch activities.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchActivities();

    // Cleanup function
    return () => {
      setSelectedCategory(null);
    };
  }, [selectedAssistant._id, activityTool]);

  const filteredActivities = activities
    .filter(
      (activity) =>
        !selectedCategory || activity.category === selectedCategory
    )
    .filter((activity) => {
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        activity.excursion_name.toLowerCase().includes(term) ||
        activity.time.toLowerCase().includes(term) ||
        activity.description.toLowerCase().includes(term) ||
        activity.location.toLowerCase().includes(term) ||
        activity.category.toLowerCase().includes(term) ||
        activity.client_code.toLowerCase().includes(term)
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

    const newMatchIndex = Math.max(0, Math.min(matchIndex, allMatches.length - 1));
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
  }, [searchTerm, matchIndex, filteredActivities]);

  const handlePrevMatch = () => {
    setMatchIndex((prev) => (prev > 0 ? prev - 1 : matchCount - 1));
  };

  const handleNextMatch = () => {
    setMatchIndex((prev) => (prev < matchCount - 1 ? prev + 1 : 0));
  };

  const handleEditActivity = async (data: ActivityFormData) => {
    try {
      const response = await fetch(`/api/contentDetail/activity/${editingActivity?._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (result?.success) {
        const updatedActivities = await fetch(`/api/contentList/activity/${selectedAssistant._id}`);
        if (updatedActivities?.ok) {
          const updatedResult = await updatedActivities.json();
          if (updatedResult?.success && updatedResult?.data) {
            setActivities(updatedResult.data);
          }
        }
        setEditingActivity(null);
        setShowActivityModal(false);
        activityForm.reset();
        toast({
          title: "Success",
          description: "Activity updated successfully",
        });
      }
    } catch (error) {
      console.error("Error updating activity:", error);
      toast({
        title: "Error",
        description: "Failed to update activity",
        variant: "destructive",
      });
    }
  };

  const handleDeleteActivity = async (activityId: string) => {
    try {
      const response = await fetch(`/api/contentDetail/activity/${activityId}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (result?.success) {
        const updatedActivities = await fetch(`/api/contentList/activity/${selectedAssistant._id}`);
        if (updatedActivities?.ok) {
          const updatedResult = await updatedActivities.json();
          if (updatedResult?.success && updatedResult?.data) {
            setActivities(updatedResult?.data);
          }
        }
        setActivityToDelete(null);
        toast({
          title: "Success",
          description: "Activity deleted successfully",
        });
      }
    } catch (error) {
      console.error("Error deleting activity:", error);
      toast({
        title: "Error",
        description: "Failed to delete activity",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      {activityTool && (
        <div className="space-y-6 w-full">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Activities</h2>
              <p className="text-sm text-muted-foreground">
                Manage activities and excursions for this assistant.
              </p>
            </div>
            <Dialog
              open={showActivityModal}
              onOpenChange={(open) => {
                if (!open) {
                  activityForm.reset();
                  setEditingActivity(null);
                }
                setShowActivityModal(open);
              }}
            >
              <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-[#0097B2] to-[#003E49] hover:from-[#008299] hover:to-[#00313A] text-white">
                  Add Activity
                </Button>
              </DialogTrigger>
              <DialogContent>
                <h2 className="text-lg font-semibold mb-4">
                  {editingActivity ? "Edit Activity" : "Create Activity"}
                </h2>
                <Form {...activityForm}>
                  <form className="space-y-4">
                    <FormField
                      control={activityForm.control}
                      name="excursion_name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Activity Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Excursion name" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={activityForm.control}
                      name="time"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Time</FormLabel>
                          <FormControl>
                            <Input placeholder="Time" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={activityForm.control}
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
                      control={activityForm.control}
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
                      control={activityForm.control}
                      name="photo_url"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Photo URL</FormLabel>
                          <FormControl>
                            <Input placeholder="Photo URL" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={activityForm.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Category (will be displayed in UPPERCASE)"
                              value={field.value}
                              onChange={(e) => {
                                const value = e.target.value.toUpperCase();
                                field.onChange(value);
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={activityForm.control}
                      name="is_active"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Active Status</FormLabel>
                          <Select
                            onValueChange={(value) =>
                              field.onChange(value === "true")
                            }
                            defaultValue={field.value ? "true" : "false"}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select status" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="true">Active</SelectItem>
                              <SelectItem value="false">Inactive</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={activityForm.control}
                      name="client_code"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Client Code</FormLabel>
                          <FormControl>
                            <Input placeholder="Client code" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      className="mt-4 w-full"
                      onClick={(e) => {
                        e.preventDefault();
                        activityForm.handleSubmit(async (data) => {
                          try {
                            if (editingActivity) {
                              await handleEditActivity(data);
                            } else {
                              const response = await fetch(`/api/contentList/activity/${selectedAssistant._id}`, {
                                method: 'POST',
                                headers: {
                                  'Content-Type': 'application/json',
                                },
                                body: JSON.stringify(data),
                              });
                              const result = await response.json();
                              if (result?.success) {
                                const updatedActivities = await fetch(`/api/contentList/activity/${selectedAssistant._id}`);
                                if (
                                  updatedActivities?.ok
                                ) {
                                  const updatedResult = await updatedActivities.json();
                                  if (updatedResult?.success && updatedResult?.data) {
                                    setActivities(updatedResult.data);
                                  }
                                }
                                setShowActivityModal(false);
                                activityForm.reset();
                                toast({
                                  title: "Success",
                                  description: "Activity created successfully",
                                });
                              }
                            }
                          } catch (error) {
                            console.error("Error saving activity:", error);
                            toast({
                              title: "Error",
                              description: "Failed to save activity",
                              variant: "destructive",
                            });
                          }
                        })();
                      }}
                    >
                      {editingActivity ? "Update Activity" : "Create Activity"}
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
                  placeholder="Search activities..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
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

          {isLoading ? (
            <div className="flex justify-center items-center h-24">
              <p>Loading activities...</p>
            </div>
          ) : activities.length > 0 ? (
            <div className="space-y-6">
              {/* Category filter */}
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant="outline"
                  className={`cursor-pointer ${
                    !selectedCategory ? "bg-primary text-primary-foreground" : ""
                  }`}
                  onClick={() => setSelectedCategory(null)}
                >
                  All Categories
                </Badge>
                {activityCategories.map((category, index) => (
                  <Badge
                    key={index}
                    variant="outline"
                    className={`cursor-pointer uppercase ${
                      selectedCategory === category
                        ? "bg-primary text-primary-foreground"
                        : ""
                    }`}
                    onClick={() => setSelectedCategory(category)}
                  >
                    {category}
                  </Badge>
                ))}
              </div>

              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full table-fixed">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium w-[25%]">
                        Activity Name
                      </th>
                      <th className="text-left p-3 font-medium w-[15%]">Time</th>
                      <th className="text-left p-3 font-medium w-[20%]">
                        Location
                      </th>
                      <th className="text-left p-3 font-medium w-[15%]">
                        Category
                      </th>
                      <th className="text-left p-3 font-medium w-[10%]">
                        Active
                      </th>
                      <th className="text-right p-3 font-medium w-[15%]">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody ref={tableBodyRef}>
                    {filteredActivities
                      .map((activity, index) => (
                        <tr
                          key={activity._id}
                          className={
                            index % 2 === 0 ? "bg-background" : "bg-muted/30"
                          }
                        >
                          <td className="p-3">{getHighlightedText(activity.excursion_name, searchTerm)}</td>
                          <td className="p-3">{getHighlightedText(activity.time, searchTerm)}</td>
                          <td className="p-3">{getHighlightedText(activity.location, searchTerm)}</td>
                          <td className="p-3">
                            <Badge variant="secondary" className="uppercase">
                              {getHighlightedText(activity.category, searchTerm)}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <Badge
                              variant={activity.is_active ? "default" : "secondary"}
                            >
                              {activity.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <div className="flex gap-2 justify-end">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => {
                                  setEditingActivity(activity);
                                  activityForm.reset(activity);
                                  setShowActivityModal(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="icon"
                                onClick={() => activity._id && setActivityToDelete(activity._id)}
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
            </div>
          ) : (
            <div className="text-center p-8 border rounded-lg bg-muted/10">
              <p className="text-muted-foreground">No activities found.</p>
            </div>
          )}
        </div>
      )}

      <AlertDialog
        open={!!activityToDelete}
        onOpenChange={() => setActivityToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              activity.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                activityToDelete && handleDeleteActivity(activityToDelete)
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
} 