import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { X } from "lucide-react";

interface AddTaskModalProps {
  onClose: () => void;
}

export default function AddTaskModal({ onClose }: AddTaskModalProps) {
  const [formData, setFormData] = useState({
    title: "",
    priority: 2,
    estimateMins: 30,
    dueAt: "",
    context: ""
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const createTaskMutation = useMutation({
    mutationFn: api.createTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      toast({ title: "Task created successfully" });
      onClose();
    },
    onError: () => {
      toast({ 
        title: "Failed to create task", 
        variant: "destructive" 
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return;

    createTaskMutation.mutate({
      title: formData.title,
      source: 'manual' as const,
      status: 'pending' as const,
      priority: formData.priority,
      estimateMins: formData.estimateMins || null,
      dueAt: formData.dueAt ? new Date(formData.dueAt) : null,
      context: formData.context ? { note: formData.context } : null,
      aiSuggested: false,
      url: null
    });
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-md mx-4">
        <DialogHeader>
          <DialogTitle>
            Add New Task
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="title">Task Title</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Enter task title..."
              required
              data-testid="input-task-title"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="priority">Priority</Label>
              <Select 
                value={formData.priority.toString()} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, priority: parseInt(value) }))}
              >
                <SelectTrigger data-testid="select-task-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Low</SelectItem>
                  <SelectItem value="2">Medium</SelectItem>
                  <SelectItem value="3">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="estimateMins">Estimated Time</Label>
              <Select 
                value={formData.estimateMins.toString()} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, estimateMins: parseInt(value) }))}
              >
                <SelectTrigger data-testid="select-task-estimate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 min</SelectItem>
                  <SelectItem value="30">30 min</SelectItem>
                  <SelectItem value="60">1 hour</SelectItem>
                  <SelectItem value="120">2 hours</SelectItem>
                  <SelectItem value="240">4 hours</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div>
            <Label htmlFor="dueAt">Due Date (Optional)</Label>
            <Input
              id="dueAt"
              type="datetime-local"
              value={formData.dueAt}
              onChange={(e) => setFormData(prev => ({ ...prev, dueAt: e.target.value }))}
              data-testid="input-task-due-date"
            />
          </div>
          
          <div>
            <Label htmlFor="context">Notes (Optional)</Label>
            <Textarea
              id="context"
              value={formData.context}
              onChange={(e) => setFormData(prev => ({ ...prev, context: e.target.value }))}
              placeholder="Additional context or notes..."
              rows={3}
              data-testid="textarea-task-notes"
            />
          </div>
          
          <div className="flex space-x-3 pt-4">
            <Button 
              type="submit" 
              disabled={createTaskMutation.isPending || !formData.title.trim()}
              className="flex-1 bg-blue-600 text-white hover:bg-blue-700"
              data-testid="button-submit-task"
            >
              {createTaskMutation.isPending ? "Creating..." : "Add Task"}
            </Button>
            <Button 
              type="button" 
              variant="outline"
              onClick={onClose}
              data-testid="button-cancel-task"
            >
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
