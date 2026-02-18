import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@dashboard/components/ui/alert-dialog";
import { Button } from "@dashboard/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@dashboard/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@dashboard/components/ui/form";
import { Input } from "@dashboard/components/ui/input";
import { toast } from "@dashboard/hooks/use-toast";
import { cn } from "@dashboard/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Registration, RegistrationSchema } from '../../types/assistant-content/registration';
import { IAssistant } from "@nia/prism/core/blocks/assistant.block";

interface RegistrationsSectionProps {
  selectedAssistant: IAssistant;
}

export default function RegistrationsSection({ selectedAssistant: assistant }: RegistrationsSectionProps) {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [showRegistrationModal, setShowRegistrationModal] = useState(false);
  const [editingRegistration, setEditingRegistration] = useState<Registration | null>(null);
  const [registrationToDelete, setRegistrationToDelete] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const registrationForm = useForm<z.infer<typeof RegistrationSchema>>({
    resolver: zodResolver(RegistrationSchema),
    mode: "onSubmit",
    defaultValues: {
      assistant_id: assistant._id!,
      registrationUrl: ""
    },
  });

  // Check if assistant supports this content type
  const contentType = 'Registration';
  const isSupported = assistant?.contentTypes?.includes(contentType);

  useEffect(() => {
    if (!isSupported || !assistant._id) return;
    setIsLoading(true);
    fetch(`/api/contentList?type=Registration&assistantId=${assistant._id}`)
      .then((res) => res.json())
      .then((data) => setRegistrations(data.items || []))
      .finally(() => setIsLoading(false));
  }, [assistant, isSupported]);

  const handleDeleteRegistration = async (registrationId: string) => {
    try {
      const res = await fetch(`/api/contentDetail?type=Registration&assistantId=${assistant._id}&id=${registrationId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetch(`/api/contentList?type=Registration&assistantId=${assistant._id}`)
          .then((res) => res.json())
          .then((data) => setRegistrations(data.items || []));
        setRegistrationToDelete(null);
        toast({ title: "Success", description: "Registration deleted successfully" });
      }
    } catch (error) {
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
          fetch(`/api/contentDetail?type=Registration&assistantId=${assistant._id}&id=${reg._id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...reg, isActive: false }),
          })
        )
      );
      // Activate the selected registration
      await fetch(`/api/contentDetail?type=Registration&assistantId=${assistant._id}&id=${registrationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      });
      fetch(`/api/contentList?type=Registration&assistantId=${assistant._id}`)
        .then((res) => res.json())
        .then((data) => setRegistrations(data.items || []));
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

  if (!isSupported) {
    return <div>This content type is not supported by {assistant?.name}</div>;
  }
  return (
    <div className="space-y-6 w-full">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Event Registration</h2>
            <p className="text-sm text-muted-foreground">
              Manage event registration URLs
            </p>
          </div>
          <Dialog
            open={showRegistrationModal}
            onOpenChange={(open) => {
              if (!open) {
                registrationForm.reset();
                setEditingRegistration(null);
              }
              setShowRegistrationModal(open);
            }}
          >
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-[#0097B2] to-[#003E49] hover:from-[#008299] hover:to-[#00313A] text-white">Add Registration URL</Button>
            </DialogTrigger>
            <DialogContent>
              <h2 className="text-lg font-semibold mb-4">
                {editingRegistration ? "Edit Registration" : "Deploy New Registration"}
              </h2>
              <Form {...registrationForm}>
                <form className="space-y-4">
                  <FormField
                    control={registrationForm.control}
                    name="registrationUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Registration URL</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="https://example.com/register"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="mt-4 w-full"
                    disabled={isLoading}
                    onClick={(e) => {
                      e.preventDefault();
                      registrationForm.handleSubmit(async (data) => {
                        setIsLoading(true);
                        try {
                          let result;
                          if (editingRegistration) {
                            result = await fetch(`/api/contentDetail?type=Registration&assistantId=${assistant._id}&id=${editingRegistration._id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ ...data, assistant_id: assistant._id }),
                            });
                          } else {
                            result = await fetch(`/api/contentList?type=Registration&assistantId=${assistant._id}`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ ...data, assistant_id: assistant._id }),
                            });
                          }

                          if (result.ok) {
                            const updated = await fetch(`/api/contentList?type=Registration&assistantId=${assistant._id}`);
                            const updatedData = await updated.json();
                            setRegistrations(updatedData.items || []);
                            registrationForm.reset();
                            setShowRegistrationModal(false);
                            setEditingRegistration(null);
                            toast({
                              title: "Success",
                              description: `Registration ${editingRegistration ? "updated" : "deployed"} successfully`,
                            });
                          }
                        } catch (error: unknown) {
                          console.error("Error saving registration:", error);
                          toast({
                            title: "Error",
                            description: "Failed to save registration",
                            variant: "destructive",
                          });
                        } finally {
                            setIsLoading(false);
                        }
                      })();
                    }}
                  >
                    {isLoading ? 'Saving...' : (editingRegistration ? "Update Registration" : "Deploy URL")}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        {registrations.length > 0 && (
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full table-fixed">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium w-[60%]">Registration URL</th>
                  <th className="text-left p-3 font-medium w-[20%]">Status</th>
                  <th className="text-right p-3 font-medium w-[20%]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {registrations.map((registration) => (
                  <tr
                    key={registration._id as string}
                    className="border-b bg-background"
                  >
                    <td className="p-3">
                      <a
                        href={registration.registrationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {registration.registrationUrl}
                      </a>
                    </td>
                    <td className="p-3">
                      <Button
                        variant={registration.isActive ? "default" : "outline"}
                        className={cn(
                          "transition-colors",
                          registration.isActive && "bg-green-600 hover:bg-green-700"
                        )}
                        onClick={() => handleActivateRegistration(registration._id as string)}
                        disabled={registration.isActive || isLoading}
                      >
                        {registration.isActive ? "Activated" : "Activate"}
                      </Button>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            setEditingRegistration(registration);
                            registrationForm.setValue(
                              "registrationUrl",
                              registration.registrationUrl
                            );
                            setShowRegistrationModal(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="icon"
                          onClick={() => window.open(registration.registrationUrl, '_blank')}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => setRegistrationToDelete(registration._id as string)}
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
      <AlertDialog
        open={!!registrationToDelete}
        onOpenChange={() => setRegistrationToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the registration URL.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => registrationToDelete && handleDeleteRegistration(registrationToDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
} 