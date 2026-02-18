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
import { Service as IService, ServiceSchema } from '../../types/assistant-content/service';
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ITool } from "@nia/prism/core/blocks/tool.block";
import { IAssistant } from "@nia/prism/core/blocks/assistant.block";

interface ServicesSectionProps {
  selectedAssistant: IAssistant;
  menuTool?: ITool;
}

type ServiceFormData = z.infer<typeof ServiceSchema>;

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

export default function ServicesSection({
  selectedAssistant,
  menuTool,
}: ServicesSectionProps) {
  const [menuItems, setMenuItems] = useState<IService[]>([]);
  const [showMenuModal, setShowMenuModal] = useState(false);
  const [editingMenuItem, setEditingMenuItem] = useState<IService | null>(null);
  const [menuItemToDelete, setMenuItemToDelete] = useState<string | null>(null);
  const [menuCategoryInput, setMenuCategoryInput] = useState("");
  const [customMenuCategories, setCustomMenuCategories] = useState<string[]>([]);
  const [selectedMenuCategory, setSelectedMenuCategory] = useState<string | null>(null);
  const [customFields, setCustomFields] = useState<Array<{name: string, type: string, value: string}>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredServices, setFilteredServices] = useState<IService[]>([]);
  const [searchMatches, setSearchMatches] = useState<{ rowIndex: number; cellIndex: number }[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const menuForm = useForm<ServiceFormData>({
    resolver: zodResolver(ServiceSchema),
    mode: "onSubmit",
    defaultValues: {
      assistant_id: selectedAssistant._id!,
      item_name: "",
      price: 0,
      photo_url: "",
      description: "",
      category: "",
      available: true,
      prep_time_minutes: 0,
      client_code: "",
    },
  });

  useEffect(() => {
    if (!menuTool) return;
    
    const fetchMenuItems = async () => {
      setIsLoading(true);
      try {
        const result = await fetch(`/api/contentList?assistantId=${selectedAssistant._id}`);
        if (result.ok) {
          const data = await result.json();
          setMenuItems(data);
          
          const existingCategories = data
            .map((item: IService) => item.category as string)
            .filter((category: string) => category && typeof category === 'string')
            .filter((value: string, index: number, self: string[]) => 
              self.indexOf(value) === index
            );
          
          setCustomMenuCategories(existingCategories);
          setSelectedMenuCategory(null);
        } else {
          console.error("Failed to fetch menu items:", result.status);
          toast({
            title: "Error",
            description: "Failed to fetch menu items",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("Error fetching menu items:", error);
      } finally {
        setIsLoading(false);
      }
    };

    if (selectedAssistant._id) {
      fetchMenuItems();
    }
    
    return () => {
      setSelectedMenuCategory(null);
    };
  }, [selectedAssistant._id, menuTool]);

  useEffect(() => {
    const categoryFiltered = menuItems.filter(
      (item) => !selectedMenuCategory || item.category === selectedMenuCategory
    );

    if (!searchQuery) {
      setFilteredServices(categoryFiltered);
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }

    const lowercasedQuery = searchQuery.toLowerCase();
    const searchFiltered = categoryFiltered.filter(
      (item) =>
        item.item_name.toLowerCase().includes(lowercasedQuery) ||
        (item.description && item.description.toLowerCase().includes(lowercasedQuery)) ||
        (item.category && item.category.toLowerCase().includes(lowercasedQuery)) ||
        (item.price && item.price.toString().toLowerCase().includes(lowercasedQuery)) ||
        (item.prep_time_minutes && item.prep_time_minutes.toString().toLowerCase().includes(lowercasedQuery))
    );

    setFilteredServices(searchFiltered);

    const newMatches: { rowIndex: number; cellIndex: number }[] = [];
    searchFiltered.forEach((item, rowIndex) => {
        if (item.item_name.toLowerCase().includes(lowercasedQuery)) newMatches.push({ rowIndex, cellIndex: 0 });
        if (item.price && item.price.toString().toLowerCase().includes(lowercasedQuery)) newMatches.push({ rowIndex, cellIndex: 1 });
        if (item.category && item.category.toLowerCase().includes(lowercasedQuery)) newMatches.push({ rowIndex, cellIndex: 2 });
        if (item.prep_time_minutes && item.prep_time_minutes.toString().toLowerCase().includes(lowercasedQuery)) newMatches.push({ rowIndex, cellIndex: 3 });
    });
    setSearchMatches(newMatches);
    setCurrentMatchIndex(newMatches.length > 0 ? 0 : -1);
  }, [searchQuery, menuItems, selectedMenuCategory]);

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

    const handleEditMenuItem = async (data: any) => {
    try {
      const formattedData = {
        ...data,
        category: data.category === "ADD_CUSTOM" ? menuCategoryInput : data.category,
        customFields: customFields.length > 0 ? JSON.stringify(customFields) : undefined
      };
      
      if (!formattedData.category || formattedData.category === "ADD_CUSTOM") {
        toast({
          title: "Error",
          description: "Please select or add a service type",
          variant: "destructive",
        });
        return;
      }
      
      if (formattedData.category && 
          !customMenuCategories.includes(formattedData.category)) {
        setCustomMenuCategories([...customMenuCategories, formattedData.category]);
      }
      
      const result = await fetch(`/api/contentDetail/${editingMenuItem?._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formattedData),
      });
      if (result.ok) {
        const updatedItems = await fetch(`/api/contentList?assistantId=${selectedAssistant._id}`);
        if (updatedItems.ok) {
          const data = await updatedItems.json();
          setMenuItems(data);
        }
        setEditingMenuItem(null);
        setShowMenuModal(false);
        menuForm.reset({
          assistant_id: selectedAssistant._id!,
          item_name: "",
          price: 0,
          photo_url: "",
          description: "",
          category: "",
          available: true,
          prep_time_minutes: 0,
          client_code: "",
        });
        setMenuCategoryInput("");
        setSelectedMenuCategory(null);
        setCustomFields([]);
        toast({
          title: "Success",
          description: "Service updated successfully",
        });
      }
    } catch (error) {
      console.error("Error updating service:", error);
      toast({
        title: "Error",
        description: "Failed to update service",
        variant: "destructive",
      });
    }
  };

  const handleDeleteMenuItem = async (itemId: string) => {
    try {
      const result = await fetch(`/api/contentDetail/${itemId}`, {
        method: 'DELETE',
      });
      if (result.ok) {
        const updatedItems = await fetch(`/api/contentList?assistantId=${selectedAssistant._id}`);
        if (updatedItems.ok) {
          const data = await updatedItems.json();
          setMenuItems(data);
        }
        setMenuItemToDelete(null);
        toast({
          title: "Success",
          description: "Menu item deleted successfully",
        });
      }
    } catch (error) {
      console.error("Error deleting menu item:", error);
      toast({
        title: "Error",
        description: "Failed to delete menu item",
        variant: "destructive",
      });
    }
  };


  return (
    <>
      {menuTool && (
        <div className="space-y-6 w-full">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Services</h2>
              <p className="text-sm text-muted-foreground">
                Manage services for this assistant.
              </p>
            </div>
            <Dialog
              open={showMenuModal}
              onOpenChange={(open) => {
                if (!open) {
                  menuForm.reset();
                  setEditingMenuItem(null);
                }
                setShowMenuModal(open);
              }}
            >
              <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-[#0097B2] to-[#003E49] hover:from-[#008299] hover:to-[#00313A] text-white">Add Service</Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <h2 className="text-lg font-semibold mb-4">
                  {editingMenuItem ? "Edit Service" : "Create Service"}
                </h2>
                <Form {...menuForm}>
                  <form className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-4">
                    <FormField
                      control={menuForm.control}
                      name="item_name"
                      render={({ field }) => (
                        <FormItem>
                              <FormLabel>Service Name</FormLabel>
                          <FormControl>
                                <Input placeholder="Service name" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={menuForm.control}
                      name="price"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Price</FormLabel>
                          <FormControl>
                            <Input placeholder="Price" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={menuForm.control}
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
                      control={menuForm.control}
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
                      </div>

                      <div className="space-y-4">
                    <FormField
                      control={menuForm.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                              <FormLabel>Service Type</FormLabel>
                            <FormControl>
                                <div className="space-y-2">
                                  {customMenuCategories.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mb-2">
                                      {customMenuCategories.map((category, index) => (
                                        <Badge
                                          key={index}
                                          variant="outline"
                                          className="cursor-pointer hover:bg-muted"
                                          onClick={() => {
                                            field.onChange(category);
                                            setMenuCategoryInput(category);
                                          }}
                                        >
                                  {category}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                  <Input 
                                    placeholder="Enter service type and press Enter (will be displayed in UPPERCASE)" 
                                    value={menuCategoryInput}
                                    onChange={(e) => {
                                      const value = e.target.value.toUpperCase();
                                      setMenuCategoryInput(value);
                                      field.onChange(value);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        if (menuCategoryInput.trim() && !customMenuCategories.includes(menuCategoryInput)) {
                                          setCustomMenuCategories([...customMenuCategories, menuCategoryInput]);
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
                        
                        <FormField
                          control={menuForm.control}
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

                    <FormField
                      control={menuForm.control}
                      name="available"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Available</FormLabel>
                          <Select
                            onValueChange={(value) => field.onChange(value === "true")}
                            defaultValue={String(field.value)}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select availability" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="true">Yes</SelectItem>
                              <SelectItem value="false">No</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={menuForm.control}
                      name="prep_time_minutes"
                      render={({ field }) => (
                        <FormItem>
                              <FormLabel>Duration (minutes)</FormLabel>
                          <FormControl>
                                <Input placeholder="Duration in minutes" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="mt-4 w-full"
                      onClick={(e) => {
                        e.preventDefault();
                        menuForm.handleSubmit(async (data) => {
                          try {
                            const formattedData = {
                              ...data,
                              category: data.category === "ADD_CUSTOM" ? menuCategoryInput : data.category,
                            };
                            
                            if (!formattedData.category || formattedData.category === "ADD_CUSTOM") {
                              toast({
                                title: "Error",
                                description: "Please select or add a service type",
                                variant: "destructive",
                              });
                              return;
                            }
                            
                            if (formattedData.category && 
                                !customMenuCategories.includes(formattedData.category)) {
                              setCustomMenuCategories([...customMenuCategories, formattedData.category]);
                            }
                            
                            if (editingMenuItem) {
                              await handleEditMenuItem(formattedData);
                            } else {
                              const result = await fetch(`/api/contentList`, {
                                method: 'POST',
                                headers: {
                                  'Content-Type': 'application/json',
                                },
                                body: JSON.stringify(formattedData),
                              });
                              if (result.ok) {
                                const updatedItems = await fetch(`/api/contentList?assistantId=${selectedAssistant._id}`);
                                if(result.ok) {
                                  const data = await updatedItems.json();
                                  setMenuItems(data);
                                }
                                
                                setShowMenuModal(false);
                                menuForm.reset({
                                  assistant_id: selectedAssistant._id!,
                                  item_name: "",
                                  price: 0,
                                  photo_url: "",
                                  description: "",
                                  category: "",
                                  available: true,
                                  prep_time_minutes: 0,
                                  client_code: "",
                                });
                                setMenuCategoryInput("");
                                setSelectedMenuCategory(null);
                                setCustomFields([]);
                                toast({
                                  title: "Success",
                                  description: "Service created successfully",
                                });
                              }
                            }
                          } catch (error) {
                            console.error(error);
                            toast({
                              title: "Error",
                              description: "Failed to save service",
                              variant: "destructive",
                            });
                          }
                        })();
                      }}
                    >
                      {editingMenuItem ? "Update Service" : "Create Service"}
                    </Button>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {isLoading ? (
            <div className="flex justify-center items-center h-24">
              <p>Loading services...</p>
            </div>
          ) : menuItems.length === 0 ? (
             <div className="text-center p-8 border rounded-lg bg-muted/10">
              <p className="text-muted-foreground">No services found.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <Input
                  placeholder="Search by name, category, price..."
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

              <div className="flex flex-wrap gap-2 mb-4">
                <Badge 
                  variant="outline" 
                  className={`cursor-pointer ${!selectedMenuCategory ? 'bg-primary text-primary-foreground' : ''}`}
                  onClick={() => setSelectedMenuCategory(null)}
                >
                  All Services
                </Badge>
                {customMenuCategories.map((category, index) => (
                  <Badge 
                    key={index}
                    variant="outline" 
                    className={`cursor-pointer uppercase ${selectedMenuCategory === category ? 'bg-primary text-primary-foreground' : ''}`}
                    onClick={() => setSelectedMenuCategory(category)}
                  >
                    {category}
                  </Badge>
                ))}
              </div>
              
            {filteredServices.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <div className="relative max-h-[calc(100vh-25rem)] overflow-y-auto">
                <table className="w-full table-fixed">
                  <thead>
                    <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 font-medium w-[25%]">Service Name</th>
                      <th className="text-left p-3 font-medium w-[15%]">Price</th>
                      <th className="text-left p-3 font-medium w-[20%]">Category</th>
                        <th className="text-left p-3 font-medium w-[15%]">Duration</th>
                      <th className="text-left p-3 font-medium w-[10%]">Available</th>
                      <th className="text-right p-3 font-medium w-[15%]">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                      {filteredServices
                        .map((item, index) => (
                      <tr
                        key={item._id}
                        ref={(el) => { rowRefs.current[index] = el; }}
                        className={`${index % 2 === 0 ? "bg-background" : "bg-muted/30"} ${
                          currentMatchIndex !== -1 && searchMatches[currentMatchIndex]?.rowIndex === index
                            ? 'outline outline-2 outline-offset-[-2px] outline-blue-500 dark:outline-blue-400'
                            : ''
                        }`}
                      >
                        <td className="p-3"><Highlight text={item.item_name} highlight={searchQuery} /></td>
                          <td className="p-3"><Highlight text={String(item.price)} highlight={searchQuery} /></td>
                          <td className="p-3">
                            <Badge variant="secondary" className="uppercase">
                              <Highlight text={item.category as string} highlight={searchQuery} />
                            </Badge>
                          </td>
                          <td className="p-3"><Highlight text={String(item.prep_time_minutes)} highlight={searchQuery} /> min</td>
                        <td className="p-3">
                          <Badge variant={item.available ? "default" : "secondary"}>
                            {item.available ? "Yes" : "No"}
                          </Badge>
                          {item.customFields && (
                            <Badge variant="outline" className="ml-2">
                              Custom Fields
                            </Badge>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex gap-2 justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() => {
                                setEditingMenuItem(item);
                                const formData: ServiceFormData = {
                                  ...item,
                                  available: item.available ?? true,
                                  customFields: typeof item.customFields === 'string' ? item.customFields : JSON.stringify(item.customFields || {})
                                };
                                menuForm.reset(formData);
                                setMenuCategoryInput(item.category as string);
                                
                                if (item.customFields) {
                                  try {
                                    const parsedFields = typeof item.customFields === 'string' 
                                      ? JSON.parse(item.customFields) 
                                      : item.customFields;
                                    setCustomFields(parsedFields);
                                  } catch (e) {
                                    console.error("Error parsing custom fields:", e);
                                    setCustomFields([]);
                                  }
                                } else {
                                  setCustomFields([]);
                                }
                                
                                setShowMenuModal(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon"
                              onClick={() => setMenuItemToDelete(item._id || null)}
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
                  <p className="text-muted-foreground">No results found for "{searchQuery}".</p>
                </div>
              )}
            </div>
          )}
        <AlertDialog
        open={!!menuItemToDelete}
        onOpenChange={() => setMenuItemToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the service.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => menuItemToDelete && handleDeleteMenuItem(menuItemToDelete as string)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        </div>
      )}
    </>
  )
} 