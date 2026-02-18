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
import { ChevronDown, Pencil, PlusCircle, Search, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { GuestSchema, Guest as IGuest } from '../../types/assistant-content/guest';
import { IAssistant } from '@nia/prism/core/blocks/assistant.block';
import { ITool } from '@nia/prism/core/blocks/tool.block';


interface GuestSectionProps {
  selectedAssistant: IAssistant;
  guestTool?: ITool;
}

type GuestFormData = z.infer<typeof GuestSchema>;

export default function GuestSection({
  selectedAssistant,
  guestTool,
}: GuestSectionProps) {
  const [guests, setGuests] = useState<IGuest[]>([]);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [editingGuest, setEditingGuest] = useState<IGuest | null>(null);
  const [guestToDelete, setGuestToDelete] = useState<string | null>(null);
  const [interestInput, setInterestInput] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    guests: false,
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);

  const guestForm = useForm<GuestFormData>({
    resolver: zodResolver(GuestSchema),
    mode: "onSubmit",
    defaultValues: {
      assistant_id: selectedAssistant._id!,
      name: "",
      phone_number: "",
      passPhrase: "",
      interests: [] as string[],
    },
  });

  useEffect(() => {
    if (!selectedAssistant._id || !guestTool) return;
    const fetchGuests = async () => {
      setIsLoading(true);
      try {
        const guests = await fetch(`/api/contentList?assistantId=${selectedAssistant._id}&type=guest`).then(res => res.json());
        setGuests(guests as IGuest[]);
      } catch (error) {
        console.error("Error fetching guests:", error);
        toast({
          title: "Error",
          description: "Failed to fetch guests.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchGuests();
  }, [selectedAssistant._id, guestTool]);

  const filteredGuests = guests.filter((guest) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const interestsString = Array.isArray(guest.interests)
      ? guest.interests.join(" ").toLowerCase()
      : "";

    return (
      (guest.name && guest.name.toLowerCase().includes(term)) ||
      (guest.phone_number && guest.phone_number.toLowerCase().includes(term)) ||
      (guest.passPhrase && guest.passPhrase.toLowerCase().includes(term)) ||
      (interestsString && interestsString.includes(term))
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
  }, [searchTerm, matchIndex, filteredGuests]);

  const handlePrevMatch = () => {
    setMatchIndex((prev) => (prev > 0 ? prev - 1 : matchCount - 1));
  };

  const handleNextMatch = () => {
    setMatchIndex((prev) => (prev < matchCount - 1 ? prev + 1 : 0));
  };

  const handleFormSubmit = async (data: GuestFormData) => {
    try {
      if (editingGuest) {
        const result = await fetch(`/api/contentDetail/${editingGuest._id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        }).then(res => res.json());
        if (result.success) {
          const updatedGuests = await fetch(`/api/contentList?assistantId=${selectedAssistant._id}&type=guest`).then(res => res.json());
          setGuests(updatedGuests as IGuest[]);
          setShowGuestModal(false);
          toast({
            title: "Success",
            description: "Guest updated successfully",
          });
        } else {
          toast({
            title: "Error",
            description: "Failed to update guest",
            variant: "destructive",
          });
        }
      } else {
        const result = await fetch(`/api/contentList?assistantId=${selectedAssistant._id}&type=guest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        }).then(res => res.json());
        if (result.success) {
          const updatedGuests = await fetch(`/api/contentList?assistantId=${selectedAssistant._id}&type=guest`).then(res => res.json());
          setGuests(updatedGuests as IGuest[]);
          setShowGuestModal(false);
          toast({
            title: "Success",
            description: "Guest created successfully",
          });
        } else {
          toast({
            title: "Error",
            description: "Failed to create guest.",
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      console.error("Error saving guest:", error);
      toast({
        title: "Error",
        description: `Failed to ${editingGuest ? "update" : "create"} guest.`,
        variant: "destructive",
      });
    }
  };

  const handleDeleteGuest = async (guestId: string) => {
    try {
      const result = await fetch(`/api/contentDetail/${guestId}`, {
        method: 'DELETE',
      }).then(res => res.json());
      if (result.success) {
        const updatedGuests = await fetch(`/api/contentList?assistantId=${selectedAssistant._id}&type=guest`).then(res => res.json());
        setGuests(updatedGuests as IGuest[]);
        setGuestToDelete(null);
        toast({
          title: "Success",
          description: "Guest deleted successfully",
        });
      }
    } catch (error) {
      console.error("Error deleting guest:", error);
      toast({
        title: "Error",
        description: "Failed to delete guest",
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

  return (
    <>
      {guestTool && (
        <div className="space-y-6 w-full">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Guests</h2>
              <p className="text-sm text-muted-foreground">
                Manage guests who can interact with this assistant.
              </p>
            </div>
            <Dialog
              open={showGuestModal}
              onOpenChange={(open) => {
                if (open) {
                  guestForm.reset({
                    assistant_id: selectedAssistant._id!,
                    name: "",
                    phone_number: "",
                    passPhrase: "",
                    interests: [],
                  });
                  setInterestInput("");
                  setEditingGuest(null);
                }
                setShowGuestModal(open);
              }}
            >
              <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-[#0097B2] to-[#003E49] hover:from-[#008299] hover:to-[#00313A] text-white">Add Guest</Button>
              </DialogTrigger>
              <DialogContent>
                <h2 className="text-lg font-semibold mb-4">
                  {editingGuest ? "Edit Guest" : "Create Guest"}
                </h2>
                <Form {...guestForm}>
                  <form className="space-y-4" onSubmit={guestForm.handleSubmit(handleFormSubmit)}>
                    <FormField
                      control={guestForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Guest name" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={guestForm.control}
                      name="phone_number"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone Number</FormLabel>
                          <FormControl>
                            <Input placeholder="Phone number" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={guestForm.control}
                      name="passPhrase"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Pass Phrase</FormLabel>
                          <FormControl>
                            <Input placeholder="Pass phrase" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={guestForm.control}
                      name="interests"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Interests</FormLabel>
                          <FormControl>
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-2">
                                {(field.value || []).map((interest: string, index: number) => (
                                  <Badge
                                    key={index}
                                    variant="secondary"
                                    className="px-2 py-1"
                                  >
                                    {interest}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const newInterests = (field.value || []).filter(
                                          (_, i) => i !== index
                                        );
                                        field.onChange(newInterests);
                                      }}
                                      className="ml-2 hover:text-destructive"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </Badge>
                                ))}
                              </div>
                              <Input
                                placeholder="Type an interest and press Enter"
                                value={interestInput}
                                onChange={(e) => setInterestInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    if (interestInput.trim()) {
                                      field.onChange([
                                        ...(field.value || []),
                                        interestInput.trim(),
                                      ]);
                                      setInterestInput("");
                                    }
                                  }
                                }}
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      className="mt-4 w-full"
                    >
                      {editingGuest ? "Update Guest" : "Create Guest"}
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
                placeholder="Search guests..."
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
              <p>Loading guests...</p>
            </div>
          ) : guests.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Guests</h2>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => toggleSection('guests')}
                    className="p-2"
                  >
                    <ChevronDown className={`h-4 w-4 transition-transform ${collapsedSections.guests ? 'rotate-180' : ''}`} />
                  </Button>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        <PlusCircle className="h-4 w-4 mr-2" />
                        Expand
                      </Button>
                    </DialogTrigger>
                  </Dialog>
                </div>
              </div>
              {!collapsedSections.guests && (
                <div className="border rounded-lg overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full table-fixed">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 font-medium w-[20%]">Name</th>
                        <th className="text-left p-3 font-medium w-[20%]">Phone Number</th>
                        <th className="text-left p-3 font-medium w-[20%]">Pass Phrase</th>
                        <th className="text-left p-3 font-medium w-[25%]">Interests</th>
                        <th className="text-right p-3 font-medium w-[15%]">Actions</th>
                      </tr>
                    </thead>
                    <tbody ref={tableBodyRef}>
                      {filteredGuests.map((guest, index) => (
                        <tr
                          key={guest._id as string}
                          className={`border-b ${
                            index % 2 === 0 ? "bg-background" : "bg-muted/30"
                            }`}
                        >
                          <td className="p-3">{getHighlightedText(guest.name, searchTerm)}</td>
                          <td className="p-3">{getHighlightedText(guest.phone_number, searchTerm)}</td>
                          <td className="p-3">{getHighlightedText(guest.passPhrase, searchTerm)}</td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-1">
                              {(guest.interests || []).map((interest, i) => (
                                <Badge key={i} variant="secondary">
                                  {getHighlightedText(interest, searchTerm)}
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
                                  setEditingGuest(guest);
                                  guestForm.reset({
                                    ...guest,
                                    assistant_id: selectedAssistant._id || '',
                                    interests: guest.interests || [],
                                  });
                                  setShowGuestModal(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="icon"
                                onClick={() =>
                                  setGuestToDelete(guest._id || null)
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
              <p className="text-muted-foreground">No guests found.</p>
            </div>
          )}
        </div>
      )}

      <AlertDialog
        open={!!guestToDelete}
        onOpenChange={() => setGuestToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              guest.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => guestToDelete && handleDeleteGuest(guestToDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
} 