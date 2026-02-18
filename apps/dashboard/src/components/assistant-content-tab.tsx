import { AssistantBlock } from "@nia/prism/core/blocks";
import { useEffect, useMemo, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { useToast } from '@dashboard/hooks/use-toast';
import { zodResolver } from "@hookform/resolvers/zod";
import { ToolBlock } from "@nia/prism/core/blocks";
import { ChevronDown, ExternalLink, Pencil, PlusCircle, Trash2 } from "lucide-react";
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
} from "./ui/alert-dialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./ui/form";
import { Input } from "./ui/input";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

import type { EventMap as EventMapType } from '../types/assistant-content/event-map';
import { Order } from '../types/assistant-content/order';
import type { Registration as RegistrationType } from '../types/assistant-content/registration';
import {
  Card, CardContent, CardHeader, CardTitle
} from "./ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tabs, TabsContent } from "./ui/tabs";

import ActivitySection from "./assistant-content/activity-section";
import AgendaSection from "./assistant-content/agenda-section";
import ExhibitorsSection from "./assistant-content/exhibitors-section";
import GuestSection from "./assistant-content/guest-section";
import IframeKeywordsSection from "./assistant-content/iframe-keywords-section";
import MemoryKeywordsSection from "./assistant-content/memory-keywords-section";
import PhotoSection from "./assistant-content/photo-section";
import RegistrationsSection from "./assistant-content/registrations-section";
import ServicesSection from "./assistant-content/services-section";
import SpeakerSection from "./assistant-content/speaker-section";
import { UploadContentButton } from './upload-content-button';

type IAssistant = AssistantBlock.IAssistant;
type ITool = ToolBlock.ITool;
type IRegistration = RegistrationType;
type IEventMap = EventMapType;
type IOrder = Order;
const AssistantSchema = AssistantBlock.AssistantSchema;

export const RegistrationSchema = z.object({
  _id: z.string(),
  assistant_id: z.string(),
  registrationUrl: z.string().url(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const EventMapSchema = z.object({
  _id: z.string().optional(),
  assistant_id: z.string(),
  eventName: z.string().min(1, "Event name is required"),
  description: z.string().optional(),
  url: z.string().url().optional(),
});

const isImageUrl = (url: string) => {
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
};

export default function AssistantContentTab({
  form,
  selectedAssistant,
}: {
  form: UseFormReturn<z.infer<typeof AssistantSchema>>;
  selectedAssistant: IAssistant;
}) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [tools, setTools] = useState<ITool[]>([]);
  const [photoTool, setPhotoTool] = useState<ITool | null>(null);
  const [guestTool, setGuestTool] = useState<ITool | null>(null);
  const [activityTool, setActivityTool] = useState<ITool | null>(null);
  const [speakerTool, setSpeakerTool] = useState<ITool | null>(null);
  const [exhibitorTool, setExhibitorTool] = useState<ITool | null>(null);
  const [agendaTool, setAgendaTool] = useState<ITool | null>(null);
  const [menuTool, setMenuTool] = useState<ITool | null>(null);
  
  const [activeTab, setActiveTab] = useState<string>("registrations");
  
  const [registrations, setRegistrations] = useState<RegistrationType[]>([]);
  const [showRegistrationModal, setShowRegistrationModal] = useState(false);
  const [editingRegistration, setEditingRegistration] = useState<RegistrationType | null>(null);
  const [registrationToDelete, setRegistrationToDelete] = useState<string | null>(null);

  const registrationForm = useForm({
    resolver: zodResolver(RegistrationSchema),
    mode: "onSubmit",
    defaultValues: {
      assistant_id: selectedAssistant._id?.toString() || "",
      registrationUrl: ""
    },
  });

  // Add state for orders
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // Add state for order categories
  const [orderCategories, setOrderCategories] = useState<string[]>([]);
  const [selectedOrderCategory, setSelectedOrderCategory] = useState<string | null>(null);

  const [eventMapTool, setEventMapTool] = useState<ITool | null>(null);
  const [eventMapItems, setEventMapItems] = useState<EventMapType[]>([]);
  const [showEventMapModal, setShowEventMapModal] = useState(false);
  const [editingEventMap, setEditingEventMap] = useState<EventMapType | null>(null);
  const [eventMapToDelete, setEventMapToDelete] = useState<string | null>(null);

  const eventMapForm = useForm({
    resolver: zodResolver(EventMapSchema),
    mode: "onSubmit",
    defaultValues: {
      assistant_id: selectedAssistant._id?.toString() || "",
      eventName: "",
      description: "",
      url: ""
    },
  });

  const [keywordTool, setKeywordTool] = useState<ITool | null>(null);
  const [iframeKeywordTool, setIframeKeywordTool] = useState<ITool | null>(null);
  const toolIds = form.watch('model.tools');

  const TABS = useMemo(() => {
    const tabs = [{ value: "registrations", label: "Registrations" }];
    if (photoTool) tabs.push({ value: "photos", label: "Photos" });
    if (guestTool) tabs.push({ value: "guests", label: "Guests" });
    if (menuTool) tabs.push({ value: "services", label: "Services" });
    if (activityTool) tabs.push({ value: "activities", label: "Activities" });
    if (speakerTool) tabs.push({ value: "speakers", label: "Speakers" });
    if (agendaTool) tabs.push({ value: "agenda", label: "Agenda" });
    if (exhibitorTool) tabs.push({ value: "exhibitors", label: "Exhibitors" });
    tabs.push({ value: "orders", label: "Orders" });
    if (eventMapTool) tabs.push({ value: "event-maps", "label": "Event Maps" });
    tabs.push({ value: "keywords", "label": "Memory Keywords" });
    if (iframeKeywordTool) tabs.push({ value: "iframe-keywords", label: "Iframe Keywords" });

    return tabs;
  }, [photoTool, guestTool, menuTool, activityTool, speakerTool, agendaTool, exhibitorTool, eventMapTool, iframeKeywordTool]);

  useEffect(() => {
    const fetchTools = async () => {
      try {
        setIsLoading(true);

        if (toolIds && toolIds.length > 0) {
          const response = await fetch(`/api/tools/list?ids=${toolIds.join(',')}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          });
          if (response.ok) {
            const data = await response.json();
            const tools = data.tools;
            setTools(tools);
            setPhotoTool(
              tools.find((tool: any) => tool.function?.name === "showPhotos") ?? null
            );
            setGuestTool(
              tools.find((tool: any) => tool.function?.name === "guestList") ?? null
            );
            setMenuTool(
              tools.find((tool: any) => tool.function?.name === "showServices") ?? null
            );
            setActivityTool(
              tools.find((tool: any) => tool.function?.name === "showActivities") ?? null
            );
            setSpeakerTool(
              tools.find((tool: any) => tool.function?.name === "showSpeakers") ?? null
            );
            setAgendaTool(
              tools.find((tool: any) => tool.function?.name === "showAgenda") ?? null
            );
            setEventMapTool(
              tools.find((tool: any) => tool.function?.name === "showEventMap") ?? null
            );
            setKeywordTool(
              tools.find((tool: any) => tool.function?.name === "showKeywords") ?? null
            );
            setExhibitorTool(
              tools.find((tool: any) => tool.function?.name === "showExhibitors") ?? null
            );
            setIframeKeywordTool(
              tools.find((tool: any) => tool.function?.name === "IframeKeyword") ?? null
            );
          } else {
            setTools([]);
          }
        } else {
            setTools([]);
            setPhotoTool(null);
            setGuestTool(null);
            setMenuTool(null);
            setActivityTool(null);
            setSpeakerTool(null);
            setAgendaTool(null);
            setEventMapTool(null);
            setKeywordTool(null);
            setExhibitorTool(null);
            setIframeKeywordTool(null);
        }
      } catch (error) {
        console.error("Error fetching tools:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTools();
  }, [toolIds]);


  useEffect(() => {
    const fetchRegistrations = async () => {
      const response = await fetch(`/api/registrations/list?assistantId=${selectedAssistant._id}`);
      if (response.ok) {
        const data = await response.json();
        setRegistrations(data.registrations as RegistrationType[]);
      } else {
        setRegistrations([]);
      }
    };
    fetchRegistrations();
  }, [selectedAssistant._id]);

  useEffect(() => {
    const fetchOrders = async () => {
      const response = await fetch(`/api/orders/list?assistantId=${selectedAssistant._id}`);
      if (response.ok) {
        const data = await response.json();
        setOrders(data.orders as Order[]);
      } else {
        setOrders([]);
      }
    };

    if (selectedAssistant?._id) {
      fetchOrders();
    }
  }, [selectedAssistant._id]);

  useEffect(() => {
    const fetchEventMaps = async () => {
      const response = await fetch(`/api/event-maps/list?assistantId=${selectedAssistant._id}`);
      if (response.ok) {
        const data = await response.json();
        setEventMapItems(data.eventMaps as EventMapType[]);
      } else {
        setEventMapItems([]);
      }
    };
      fetchEventMaps();
  }, [selectedAssistant._id]);

  //console.log("tools", tools);

  const handleDeleteRegistration = async (registrationId: string) => {
    try {
      const response = await fetch(`/api/registrations/delete/${registrationId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const updatedRegistrations = await fetch(`/api/registrations/list?assistantId=${selectedAssistant._id}`);
          if (updatedRegistrations.ok) {
            const updatedData = await updatedRegistrations.json();
            setRegistrations(updatedData.registrations as RegistrationType[]);
          }
          setRegistrationToDelete(null);
          toast({ title: "Success", description: "Registration deleted successfully" });
        }
      }
    } catch (error: unknown) {
      console.error("Error deleting registration:", error);
      toast({ 
        title: "Error", 
        description: "Failed to delete registration", 
        variant: "destructive" 
      });
    }
  };

  const handleActivateRegistration = async (registrationId: string) => {
    try {
      setIsLoading(true);

      // Deactivate all registrations
      await Promise.all(
        registrations.map(reg =>
          fetch(`/api/registrations/update/${reg._id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              registrationUrl: reg.registrationUrl,
              isActive: false,
              assistant_id: reg.assistant_id.toString()
            }),
          })
        )
      );

      // Activate the selected registration
      const response = await fetch(`/api/registrations/update/${registrationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      });

      if (response.ok) {
        const updated = await fetch(`/api/registrations/list?assistantId=${selectedAssistant._id}`);
        if (updated.ok) {
          const updatedData = await updated.json();
          setRegistrations(updatedData.registrations?.map((reg: RegistrationType) => ({
            ...reg,
            isActive: reg._id === registrationId
          })) || []);
        }
      }
    } catch (error) {
      console.error("Activation error:", error);
      toast({
        title: "Error",
        description: "Failed to update registration status",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteEventMap = async (eventMapId: string) => {
    try {
      const response = await fetch(`/api/event-maps/delete/${eventMapId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const updatedEventMaps = await fetch(`/api/event-maps/list?assistantId=${selectedAssistant._id}`);
          if (updatedEventMaps.ok) {
            const updatedData = await updatedEventMaps.json();
            setEventMapItems(updatedData.eventMaps as unknown as IEventMap[]);
          }
          setEventMapToDelete(null);
          toast({
            title: "Success",
            description: "Event map item deleted successfully",
          });
        }
      }
    } catch (error) {
      console.error("Error deleting event map:", error);
      toast({
        title: "Error",
        description: "Failed to delete event map item",
        variant: "destructive",
      });
    }
  };

  // Add this state at the top of the component with other states
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    speakers: false,
    tools: false,
    menuItems: false,
    registrations: false,
    orders: false,
    eventMaps: false,
  });

  // Add this toggle function
  const toggleSection = (section: string) => {
    setCollapsedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Add loading state
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <div className="p-6 bg-background text-foreground w-full overflow-x-hidden">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Assistant Content</h2>
          <p className="text-sm text-muted-foreground">
            This section allows you to configure the content for the assistant.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex items-center gap-4 mb-6">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="bg-gradient-to-r from-[#0097B2] to-[#003E49] hover:from-[#008299] hover:to-[#00313A] text-white w-full md:w-auto">
                {TABS.find(tab => tab.value === activeTab)?.label} <ChevronDown className="w-4 h-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-full md:w-[200px]">
              {TABS.map((tab) => (
                <DropdownMenuItem key={tab.value} onSelect={() => setActiveTab(tab.value)}>
                  {tab.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          
          <UploadContentButton assistant={selectedAssistant} />
        </div>

        <TabsContent value="registrations">
          <RegistrationsSection selectedAssistant={selectedAssistant} />
        </TabsContent>

        <TabsContent value="guests">
          <GuestSection selectedAssistant={selectedAssistant} />
        </TabsContent>
        <TabsContent value="photos">
          <PhotoSection selectedAssistant={selectedAssistant} />
        </TabsContent>
        <TabsContent value="services">
          <ServicesSection selectedAssistant={selectedAssistant} />
        </TabsContent>
        <TabsContent value="activities">
          <ActivitySection selectedAssistant={selectedAssistant} />
        </TabsContent>
        <TabsContent value="speakers">
          <SpeakerSection selectedAssistant={selectedAssistant} />
        </TabsContent>
        <TabsContent value="agenda">
          <AgendaSection selectedAssistant={selectedAssistant} />
        </TabsContent>
        <TabsContent value="exhibitors">
          <ExhibitorsSection selectedAssistant={selectedAssistant} />
        </TabsContent>
        <TabsContent value="orders">
           <Card>
              <CardHeader>
                <CardTitle>Orders</CardTitle>
              </CardHeader>
              <CardContent>
                {ordersLoading ? (
                  <p>Loading orders...</p>
                ) : (
                  <div>
                    {/* Add category filter */}
                    <div className="mb-4">
                      <Select onValueChange={(value) => setSelectedOrderCategory(value === 'all' ? null : value)} >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="Filter by category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Categories</SelectItem>
                          {orderCategories.map(category => (
                            <SelectItem key={category} value={category}>{category}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {orders.filter(order => !selectedOrderCategory || order.orderType.toString() === selectedOrderCategory).map(order => (
                      <div key={order._id} className="mb-4 p-4 border rounded-lg">
                        <p><strong>Service:</strong> {order.spaServiceOrder?.serviceName || order.shoreExcursionOrder?.excursionName || (order.roomServiceOrder ? 'Room Service' : 'N/A')}</p>
                        <p><strong>Category:</strong> {order.orderType.toString()}</p>
                        <p><strong>Customer:</strong> {order.contactInfo?.guestName || 'N/A'}</p>
                        <p><strong>Room:</strong> {order.contactInfo?.roomNumber || 'N/A'}</p>
                        <p><strong>Status:</strong> <Badge>{order.status}</Badge></p>
                        <p><strong>Price:</strong> ${order.orderTotal}</p>
                        <p><strong>Date:</strong> {new Date(order.orderDate!).toLocaleDateString()}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
        </TabsContent>
        <TabsContent value="event-maps">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Event Maps</CardTitle>
                <Button
                  onClick={() => setShowEventMapModal(true)}
                  className="bg-gradient-to-r from-[#0097B2] to-[#003E49] hover:from-[#008299] hover:to-[#00313A] text-white"
                >
                  <PlusCircle className="h-4 w-4 mr-2" />
                  Add Event Map
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {eventMapItems.length > 0 ? (
                <div className="space-y-4">
                  {eventMapItems.map((item) => (
                    <div key={item._id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <h3 className="font-medium">{item.eventName}</h3>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View Event
                          </a>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingEventMap(item);
                            eventMapForm.reset(item);
                            setShowEventMapModal(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setEventMapToDelete(item._id!)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No event maps found.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="keywords">
          <MemoryKeywordsSection selectedAssistant={selectedAssistant} />
        </TabsContent>
        <TabsContent value="iframe-keywords">
          <IframeKeywordsSection selectedAssistant={selectedAssistant} />
        </TabsContent>
      </Tabs>

      {/* Event Map Modal */}
      <Dialog open={showEventMapModal} onOpenChange={setShowEventMapModal}>
        <DialogContent>
          <h2 className="text-lg font-semibold mb-4">
            {editingEventMap ? "Edit Event Map" : "Create Event Map"}
          </h2>
          <Form {...eventMapForm}>
            <form onSubmit={eventMapForm.handleSubmit(async (data) => {
              try {
                if (editingEventMap) {
                  const response = await fetch(`/api/event-maps/update/${editingEventMap._id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                  });
                  if (response.ok) {
                    const updatedEventMaps = await fetch(`/api/event-maps/list?assistantId=${selectedAssistant._id}`);
                    if (updatedEventMaps.ok) {
                      const updatedData = await updatedEventMaps.json();
                      setEventMapItems(updatedData.eventMaps as unknown as IEventMap[]);
                    }
                    setShowEventMapModal(false);
                    setEditingEventMap(null);
                    eventMapForm.reset();
                    toast({
                      title: "Success",
                      description: "Event map updated successfully",
                    });
                  }
                } else {
                  const response = await fetch(`/api/event-maps/create`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                  });
                  if (response.ok) {
                    const updatedEventMaps = await fetch(`/api/event-maps/list?assistantId=${selectedAssistant._id}`);
                    if (updatedEventMaps.ok) {
                      const updatedData = await updatedEventMaps.json();
                      setEventMapItems(updatedData.eventMaps as unknown as IEventMap[]);
                    }
                    setShowEventMapModal(false);
                    eventMapForm.reset();
                    toast({
                      title: "Success",
                      description: "Event map created successfully",
                    });
                  }
                }
              } catch (error) {
                console.error("Error saving event map:", error);
                toast({
                  title: "Error",
                  description: "Failed to save event map",
                  variant: "destructive",
                });
              }
            })}>
              <div className="space-y-4">
                <FormField
                  control={eventMapForm.control}
                  name="eventName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Event Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Event name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={eventMapForm.control}
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
                  control={eventMapForm.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>URL</FormLabel>
                      <FormControl>
                        <Input placeholder="Event URL" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex gap-2">
                  <Button type="submit" className="flex-1">
                    {editingEventMap ? "Update Event Map" : "Create Event Map"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowEventMapModal(false);
                      setEditingEventMap(null);
                      eventMapForm.reset();
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Event Map Delete Confirmation */}
      <AlertDialog open={!!eventMapToDelete} onOpenChange={() => setEventMapToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the event map item.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => eventMapToDelete && handleDeleteEventMap(eventMapToDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}