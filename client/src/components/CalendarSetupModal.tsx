import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { X, Calendar, ExternalLink, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface CalendarSetupModalProps {
  onClose: () => void;
}

export default function CalendarSetupModal({ onClose }: CalendarSetupModalProps) {
  const [icsUrl, setIcsUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const syncCalendarMutation = useMutation({
    mutationFn: api.syncCalendar,
    onSuccess: () => {
      toast({ title: "Calendar synced successfully!" });
      onClose();
    },
    onError: () => {
      toast({ 
        title: "Calendar sync failed", 
        description: "Please check your iCal URL and try again.",
        variant: "destructive" 
      });
    }
  });

  const setupCalendarMutation = useMutation({
    mutationFn: (url: string) => api.setupCalendar(url),
    onSuccess: () => {
      toast({ title: "Calendar setup successful!" });
      onClose();
    },
    onError: () => {
      toast({ 
        title: "Failed to setup calendar", 
        description: "Please check your iCal URL and try again.",
        variant: "destructive" 
      });
    }
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!icsUrl.trim()) return;

    setIsLoading(true);
    try {
      await setupCalendarMutation.mutateAsync(icsUrl);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestSync = () => {
    syncCalendarMutation.mutate();
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-lg mx-4">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center">
              <Calendar className="h-5 w-5 text-blue-600 mr-2" />
              Calendar Integration Setup
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              data-testid="button-close-calendar-setup"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogTitle>
          <DialogDescription>
            Connect your Google Calendar to automatically sync your meetings and events.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            We use a read-only iCal URL from Google Calendar. No OAuth required - your calendar data stays secure.
          </AlertDescription>
        </Alert>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="icsUrl">Google Calendar iCal URL</Label>
            <Input
              id="icsUrl"
              type="url"
              value={icsUrl}
              onChange={(e) => setIcsUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/..."
              data-testid="input-ics-url"
            />
            <p className="text-xs text-gray-500 mt-1">
              Get this from your Google Calendar settings → Integrate calendar → Secret address in iCal format
            </p>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg space-y-2">
            <h4 className="font-medium text-sm">How to get your iCal URL:</h4>
            <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
              <li>Open Google Calendar on your computer</li>
              <li>Click the three dots next to your calendar name</li>
              <li>Select "Settings and sharing"</li>
              <li>Scroll to "Integrate calendar"</li>
              <li>Copy the "Secret address in iCal format" URL</li>
            </ol>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => window.open('https://calendar.google.com', '_blank')}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Open Google Calendar
            </Button>
          </div>
          
          <div className="flex space-x-3 pt-4">
            <Button 
              type="submit" 
              disabled={isLoading || !icsUrl.trim()}
              className="flex-1 bg-blue-600 text-white hover:bg-blue-700"
              data-testid="button-setup-calendar"
            >
              {isLoading ? "Setting up..." : "Setup Calendar"}
            </Button>
            <Button 
              type="button" 
              variant="outline"
              onClick={handleTestSync}
              disabled={syncCalendarMutation.isPending}
              data-testid="button-test-sync"
            >
              Test Sync
            </Button>
          </div>

          <div className="text-xs text-gray-500 text-center">
            Your calendar will automatically sync every 15 minutes once set up.
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}