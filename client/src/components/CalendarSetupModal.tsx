import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Calendar, AlertCircle, Check, Trash2, RefreshCw } from "lucide-react";

interface CalendarSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CalendarSetupModal({ open, onOpenChange }: CalendarSetupModalProps) {
  const [calendarUrl, setCalendarUrl] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch existing calendar URL
  const { data: existingUrl } = useQuery({
    queryKey: ['/api/calendar/url'],
    queryFn: api.getCalendarUrl,
    enabled: open
  });

  // Fetch existing user email
  const { data: existingEmail } = useQuery({
    queryKey: ['/api/user/email'],
    queryFn: api.getUserEmail,
    enabled: open
  });

  useEffect(() => {
    if (existingUrl?.url) setCalendarUrl(existingUrl.url);
  }, [existingUrl]);

  useEffect(() => {
    if (existingEmail?.email) setUserEmail(existingEmail.email);
  }, [existingEmail]);

  const setCalendarMutation = useMutation({
    mutationFn: (url: string) => api.setupCalendar(url),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/agenda'] });
      queryClient.invalidateQueries({ queryKey: ['/api/calendar/url'] });
      toast({ title: "Calendar connected successfully" });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Failed to connect calendar",
        description: "Please check your URL and try again",
        variant: "destructive"
      });
    }
  });

  const removeCalendarMutation = useMutation({
    mutationFn: api.removeCalendar,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/agenda'] });
      queryClient.invalidateQueries({ queryKey: ['/api/calendar/url'] });
      setCalendarUrl("");
      toast({ title: "Calendar removed successfully" });
    },
    onError: () => {
      toast({
        title: "Failed to remove calendar",
        variant: "destructive"
      });
    }
  });

  const clearEventsMutation = useMutation({
    mutationFn: api.clearCalendarEvents,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/agenda'] });
      toast({ title: "Calendar events cleared successfully" });
    },
    onError: () => {
      toast({
        title: "Failed to clear calendar events",
        variant: "destructive"
      });
    }
  });

  const syncCalendarMutation = useMutation({
    mutationFn: api.syncCalendar,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/agenda'] });
      toast({ title: "Calendar synced successfully" });
    },
    onError: () => {
      toast({
        title: "Failed to sync calendar",
        variant: "destructive"
      });
    }
  });

  const setEmailMutation = useMutation({
    mutationFn: (email: string) => api.setUserEmail(email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user/email'] });
      toast({ title: "Email saved successfully" });
    },
    onError: () => {
      toast({
        title: "Failed to save email",
        description: "Please check your email format and try again",
        variant: "destructive"
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!calendarUrl.trim()) return;
    setCalendarMutation.mutate(calendarUrl);
  };

  const handleEmailSave = () => {
    if (!userEmail.trim()) return;
    setEmailMutation.mutate(userEmail);
  };

  const isValidUrl =
    calendarUrl.includes("calendar.google.com/calendar/ical") || calendarUrl.includes(".ics");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Key bits: p-0, overflow-hidden, flex/col, min-h-0, and a fixed/max height */}
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-md w-full max-h-[80vh] p-0 overflow-hidden flex flex-col min-h-0">
        {/* Non-scrolling header */}
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-purple-500" />
            Connect Your Calendar
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Add your Google Calendar iCal URL to sync your meetings and events.
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable body */}
        <div className="flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="px-6 pb-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="user-email" className="text-gray-300">
                  Your Email
                </Label>
                <Input
                  id="user-email"
                  type="email"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  placeholder="your.email@example.com"
                  className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
                  data-testid="input-user-email"
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={handleEmailSave}
                    disabled={setEmailMutation.isPending || !userEmail.trim()}
                    className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 text-sm"
                    data-testid="button-save-email"
                  >
                    {setEmailMutation.isPending ? "Saving..." : "Save Email"}
                  </Button>
                </div>
              </div>

              <div className="border-t border-gray-700 pt-4">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="calendar-url" className="text-gray-300">
                      iCal URL
                    </Label>
                    <Input
                      id="calendar-url"
                      type="url"
                      value={calendarUrl}
                      onChange={(e) => setCalendarUrl(e.target.value)}
                      placeholder="https://calendar.google.com/calendar/ical/..."
                      className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
                      data-testid="input-calendar-url"
                    />
                    {calendarUrl && !isValidUrl && (
                      <p className="text-xs text-yellow-500">
                        This doesn't look like a valid Google Calendar iCal URL
                      </p>
                    )}
                    {existingUrl?.url && (
                      <p className="text-xs text-green-500 flex items-center gap-1">
                        <Check className="h-3 w-3" />
                        Calendar already connected
                      </p>
                    )}
                  </div>

                  <Alert className="bg-gray-800 border-gray-700">
                    <AlertCircle className="h-4 w-4 text-blue-400" />
                    <AlertDescription className="text-gray-300 text-sm">
                      <div className="space-y-2">
                        <p className="font-medium">How to get your iCal URL:</p>
                        <ol className="list-decimal list-inside space-y-1 text-xs">
                          <li>Open Google Calendar</li>
                          <li>Click the gear icon → Settings</li>
                          <li>Select your calendar from the left sidebar</li>
                          <li>Scroll to "Integrate calendar"</li>
                          <li>Copy the "Secret address in iCal format"</li>
                        </ol>
                      </div>
                    </AlertDescription>
                  </Alert>

                  <div className="flex justify-end gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onOpenChange(false)}
                      className="border-gray-700 text-gray-300 hover:bg-gray-800"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={!calendarUrl.trim() || setCalendarMutation.isPending}
                      className="bg-primary hover:bg-primary/90"
                    >
                      {setCalendarMutation.isPending
                        ? "Connecting..."
                        : existingUrl?.url
                        ? "Update Calendar"
                        : "Connect Calendar"}
                    </Button>
                  </div>
                </form>
              </div>

              {existingUrl?.url && (
                <>
                  <Separator className="bg-gray-700" />

                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-300 mb-3">
                        Calendar Management
                      </h4>
                      <div className="grid grid-cols-1 gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => syncCalendarMutation.mutate()}
                          disabled={syncCalendarMutation.isPending}
                          className="border-gray-700 text-gray-300 hover:bg-gray-800 justify-start"
                          data-testid="button-manual-sync"
                        >
                          <RefreshCw
                            className={`h-4 w-4 mr-2 ${
                              syncCalendarMutation.isPending ? "animate-spin" : ""
                            }`}
                          />
                          {syncCalendarMutation.isPending ? "Syncing..." : "Manual Sync"}
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => clearEventsMutation.mutate()}
                          disabled={clearEventsMutation.isPending}
                          className="border-gray-700 text-gray-300 hover:bg-gray-800 justify-start"
                          data-testid="button-clear-events"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {clearEventsMutation.isPending ? "Clearing..." : "Clear All Events"}
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeCalendarMutation.mutate()}
                          disabled={removeCalendarMutation.isPending}
                          className="border-red-600 text-red-400 hover:bg-red-900/20 justify-start"
                          data-testid="button-remove-calendar"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {removeCalendarMutation.isPending ? "Removing..." : "Remove Calendar"}
                        </Button>
                      </div>
                    </div>

                    <Alert className="bg-gray-800 border-gray-700">
                      <AlertCircle className="h-4 w-4 text-yellow-400" />
                      <AlertDescription className="text-gray-300 text-xs">
                        <strong>Manual Sync:</strong> Force refresh calendar events now
                        <br />
                        <strong>Clear All Events:</strong> Remove all events but keep calendar connected
                        <br />
                        <strong>Remove Calendar:</strong> Disconnect calendar and clear all events
                      </AlertDescription>
                    </Alert>
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}