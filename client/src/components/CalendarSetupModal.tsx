import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Calendar, AlertCircle, Check } from "lucide-react";

interface CalendarSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CalendarSetupModal({ open, onOpenChange }: CalendarSetupModalProps) {
  const [calendarUrl, setCalendarUrl] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch existing calendar URL
  const { data: existingUrl } = useQuery({
    queryKey: ['/api/calendar/url'],
    queryFn: api.getCalendarUrl,
    enabled: open
  });

  useEffect(() => {
    if (existingUrl?.url) {
      setCalendarUrl(existingUrl.url);
    }
  }, [existingUrl]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!calendarUrl.trim()) return;
    setCalendarMutation.mutate(calendarUrl);
  };

  const isValidUrl = calendarUrl.includes('calendar.google.com/calendar/ical') || 
                     calendarUrl.includes('.ics');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-purple-500" />
            Connect Your Calendar
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Add your Google Calendar iCal URL to sync your meetings and events.
          </DialogDescription>
        </DialogHeader>

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
              {setCalendarMutation.isPending ? "Connecting..." : 
               existingUrl?.url ? "Update Calendar" : "Connect Calendar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}