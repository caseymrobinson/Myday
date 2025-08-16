import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { Task } from "../types";
import { Plus, Edit2, Check, X, Trash2, Settings, Bot } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface TasksPanelProps {
  tasks: Task[];
  isLoading: boolean;
  onAddTask: () => void;
  onSetupCalendar: () => void;
  onPlanDay: () => void;
}

export default function TasksPanel({ tasks, isLoading, onAddTask, onSetupCalendar, onPlanDay }: TasksPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editForm, setEditForm] = useState({
    title: "",
    priority: 2,
    estimateMins: 30
  });

  // Remove date/time logic - now handled by CalendarPanel

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: any }) => 
      api.updateTask(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/agenda'] });
      toast({ title: "Task updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update task", variant: "destructive" });
    }
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/agenda'] });
      toast({ title: "Task deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete task", variant: "destructive" });
    }
  });

  const openEditDialog = (task: Task) => {
    setEditingTask(task);
    setEditForm({
      title: task.title,
      priority: task.priority,
      estimateMins: task.estimateMins || 30
    });
  };

  const handleEditSave = () => {
    if (!editingTask) return;
    
    updateTaskMutation.mutate({
      id: editingTask.id,
      updates: editForm
    });
    setEditingTask(null);
  };

  const handleComplete = (task: Task) => {
    updateTaskMutation.mutate({
      id: task.id,
      updates: { status: 'done' }
    });
  };

  const handleUncomplete = (task: Task) => {
    updateTaskMutation.mutate({
      id: task.id,
      updates: { status: 'pending' }
    });
  };

  const getPriorityColor = (priority: number) => {
    if (priority === 3) return "bg-red-500/20 text-red-400";
    if (priority === 2) return "bg-yellow-500/20 text-yellow-400";
    return "bg-blue-500/20 text-blue-400";
  };

  const getPriorityLabel = (priority: number) => {
    if (priority === 3) return "High priority";
    if (priority === 2) return "Medium priority";
    return "Low priority";
  };

  const formatDueDate = (date: Date | string | null) => {
    if (!date) return null;
    const d = new Date(date);
    return `Due ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  };

  // Separate tasks by status
  const todoTasks = tasks.filter(t => t.status !== 'done');
  const completedTasks = tasks.filter(t => t.status === 'done');

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Header */}
      <div className="px-6 py-4 bg-[#1e1e1e]">
        <h1 className="text-xl font-semibold text-white">My tasks</h1>
      </div>
      {/* Action Buttons */}
      <div className="flex gap-3 px-6 py-4 bg-[#1e1e1e]">
        <Button 
          onClick={onAddTask}
          className="bg-primary hover:bg-primary/90 text-white flex items-center gap-2"
          data-testid="button-add-task"
        >
          <Plus className="h-4 w-4" />
          Create New Task
        </Button>
        <Button 
          onClick={onPlanDay}
          className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white flex items-center gap-2"
          data-testid="button-plan-day"
        >
          <Bot className="h-4 w-4" />
          Plan My Day
        </Button>
        <Button 
          variant="ghost" 
          size="icon"
          onClick={onSetupCalendar}
          className="text-gray-400 hover:text-white hover:bg-gray-700"
          data-testid="button-settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
      {/* Tasks Container */}
      <div className="flex-1 overflow-y-auto px-6 bg-[#1E1E1E]">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-gray-500">Loading tasks...</div>
          </div>
        ) : (
          <>
            {/* To Do Section */}
            <div className="mb-6">
              <h2 className="text-sm font-medium text-gray-400 mb-3">To do</h2>
              <div className="space-y-2">
                {todoTasks.length === 0 ? (
                  <div className="text-gray-600 text-sm py-4">No tasks to do</div>
                ) : (
                  todoTasks.map((task) => (
                    <div
                      key={task.id}
                      className="rounded-xl p-4 hover:bg-gray-800 transition-colors bg-[#2D2D2D]"
                      data-testid={`task-card-${task.id}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="text-white font-medium mb-2" data-testid={`text-task-title-${task.id}`}>
                            {task.title}
                          </h3>
                          <div className="flex items-center gap-2 flex-wrap">
                            {task.estimateMins && (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-800 text-gray-400">
                                {task.estimateMins} mins
                              </span>
                            )}
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs ${getPriorityColor(task.priority)}`}>
                              {getPriorityLabel(task.priority)}
                            </span>
                            {task.dueAt && (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-800 text-gray-400">
                                {formatDueDate(task.dueAt)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 ml-4">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => openEditDialog(task)}
                                className="h-8 w-8 text-gray-400 hover:text-white hover:bg-gray-700"
                                data-testid={`button-edit-task-${task.id}`}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="bg-gray-900 border-gray-800">
                              <DialogHeader>
                                <DialogTitle className="text-white">Edit Task</DialogTitle>
                                <DialogDescription className="text-gray-400">
                                  Make changes to your task here.
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4 pt-4">
                                <div>
                                  <Label htmlFor="title" className="text-gray-300">Title</Label>
                                  <Input
                                    id="title"
                                    value={editForm.title}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                                    className="bg-gray-800 border-gray-700 text-white"
                                  />
                                </div>
                                <div>
                                  <Label htmlFor="priority" className="text-gray-300">Priority</Label>
                                  <Select value={editForm.priority.toString()} onValueChange={(value) => setEditForm(prev => ({ ...prev, priority: parseInt(value) }))}>
                                    <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-gray-800 border-gray-700">
                                      <SelectItem value="1">Low</SelectItem>
                                      <SelectItem value="2">Medium</SelectItem>
                                      <SelectItem value="3">High</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label htmlFor="estimateMins" className="text-gray-300">Estimate (minutes)</Label>
                                  <Input
                                    id="estimateMins"
                                    type="number"
                                    value={editForm.estimateMins}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, estimateMins: parseInt(e.target.value) || 30 }))}
                                    className="bg-gray-800 border-gray-700 text-white"
                                  />
                                </div>
                                <Button onClick={handleEditSave} className="w-full bg-primary hover:bg-primary/90">
                                  Save Changes
                                </Button>
                              </div>
                            </DialogContent>
                          </Dialog>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleComplete(task)}
                            className="h-8 w-8 text-gray-400 hover:text-green-400 hover:bg-gray-700"
                            data-testid={`button-complete-task-${task.id}`}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Complete Section */}
            {completedTasks.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-medium text-gray-400 mb-3">Complete</h2>
                <div className="space-y-2">
                  {completedTasks.map((task) => (
                    <div
                      key={task.id}
                      className="bg-gray-900/50 rounded-xl p-4 hover:bg-gray-800/50 transition-colors opacity-60"
                      data-testid={`task-card-completed-${task.id}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="text-gray-400 font-medium mb-2 line-through" data-testid={`text-task-title-${task.id}`}>
                            {task.title}
                          </h3>
                          <div className="flex items-center gap-2 flex-wrap">
                            {task.estimateMins && (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-800/50 text-gray-500">
                                {task.estimateMins} mins
                              </span>
                            )}
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-800/50 text-gray-500">
                              {getPriorityLabel(task.priority)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 ml-4">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleUncomplete(task)}
                            className="h-8 w-8 text-gray-500 hover:text-white hover:bg-gray-700"
                            data-testid={`button-uncomplete-task-${task.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteTaskMutation.mutate(task.id)}
                            className="h-8 w-8 text-gray-500 hover:text-red-400 hover:bg-gray-700"
                            data-testid={`button-delete-task-${task.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}