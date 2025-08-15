import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { Task } from "../types";
import { CalendarDays, Plus, Check, X, User, MessageSquare, Bot, Slack } from "lucide-react";

interface TasksPanelProps {
  tasks: Task[];
  isLoading: boolean;
  onAddTask: () => void;
  onSetupCalendar: () => void;
  onGetTodaysPlan: () => void;
}

export default function TasksPanel({ tasks, isLoading, onAddTask, onSetupCalendar, onGetTodaysPlan }: TasksPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Task> }) => 
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

  const confirmTask = (task: Task) => {
    updateTaskMutation.mutate({
      id: task.id,
      updates: { status: 'confirmed', aiSuggested: false }
    });
  };

  const markTaskDone = (task: Task) => {
    updateTaskMutation.mutate({
      id: task.id,
      updates: { status: 'done' }
    });
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'slack': return <Slack className="h-3 w-3 text-purple-500" />;
      case 'ai': return <Bot className="h-3 w-3 text-amber-500" />;
      default: return <User className="h-3 w-3 text-blue-500" />;
    }
  };

  const getPriorityBadge = (priority: number) => {
    switch (priority) {
      case 3: return <Badge variant="destructive" className="text-xs">High</Badge>;
      case 2: return <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-700">Med</Badge>;
      default: return <Badge variant="outline" className="text-xs">Low</Badge>;
    }
  };

  const formatDueDate = (dueAt: Date | null) => {
    if (!dueAt) return null;
    const date = new Date(dueAt);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    
    if (date.toDateString() === today.toDateString()) {
      return `Due: Today ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return "Due: Tomorrow";
    } else {
      return `Due: ${date.toLocaleDateString()}`;
    }
  };

  const aiTasks = tasks.filter(task => task.status === 'pending' && task.aiSuggested);
  const confirmedTasks = tasks.filter(task => task.status === 'confirmed' || (task.status === 'pending' && !task.aiSuggested));
  const doneTasks = tasks.filter(task => task.status === 'done');

  if (isLoading) {
    return (
      <div className="w-80 bg-white border-r border-gray-200 flex items-center justify-center">
        <div className="text-gray-500">Loading tasks...</div>
      </div>
    );
  }

  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Tasks</h2>
          <Button 
            onClick={onAddTask}
            className="bg-blue-600 text-white hover:bg-blue-700 text-sm"
            size="sm"
            data-testid="button-add-task"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Task
          </Button>
        </div>
        <div className="flex space-x-2">
          <Button 
            onClick={onGetTodaysPlan}
            className="flex-1 bg-amber-500 text-white hover:bg-amber-600 text-sm"
            size="sm"
            data-testid="button-todays-plan"
          >
            <CalendarDays className="h-4 w-4 mr-1" />
            Today's Plan
          </Button>
          <Button 
            onClick={onSetupCalendar}
            variant="outline"
            className="text-sm border-blue-200 text-blue-700 hover:bg-blue-50"
            size="sm"
            data-testid="button-setup-calendar"
          >
            <CalendarDays className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tasks List */}
      <div className="flex-1 overflow-y-auto">
        {/* Unconfirmed (AI) Section */}
        <div className="p-4 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center">
            <Bot className="h-4 w-4 text-amber-500 mr-2" />
            Unconfirmed (AI)
            <Badge className="ml-2 bg-amber-100 text-amber-700 text-xs">
              {aiTasks.length}
            </Badge>
          </h3>
          
          {aiTasks.map(task => (
            <Card key={task.id} className="mb-3 border-2 border-amber-200 bg-amber-50" data-testid={`card-ai-task-${task.id}`}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="text-sm font-medium text-gray-800" data-testid={`text-task-title-${task.id}`}>
                    {task.title}
                  </h4>
                  <div className="flex items-center space-x-1">
                    {getSourceIcon(task.source)}
                    <Badge className="bg-amber-500 text-white text-xs">AI</Badge>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500" data-testid={`text-task-due-${task.id}`}>
                    {formatDueDate(task.dueAt || null) || (task.estimateMins ? `Est: ${task.estimateMins} min` : '')}
                  </span>
                  <div className="flex space-x-1">
                    <Button
                      size="sm"
                      onClick={() => confirmTask(task)}
                      disabled={updateTaskMutation.isPending}
                      className="bg-green-600 text-white hover:bg-green-700 text-xs px-2 py-1 h-auto"
                      data-testid={`button-confirm-task-${task.id}`}
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Confirm
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => markTaskDone(task)}
                      disabled={updateTaskMutation.isPending}
                      variant="secondary"
                      className="text-xs px-2 py-1 h-auto"
                      data-testid={`button-done-task-${task.id}`}
                    >
                      <X className="h-3 w-3 mr-1" />
                      Done
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* My Tasks Section */}
        <div className="p-4 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center">
            <User className="h-4 w-4 text-blue-500 mr-2" />
            My Tasks
            <Badge className="ml-2 bg-blue-100 text-blue-700 text-xs">
              {confirmedTasks.length}
            </Badge>
          </h3>
          
          {confirmedTasks.map(task => (
            <Card key={task.id} className="mb-3 hover:border-gray-300 transition-colors" data-testid={`card-confirmed-task-${task.id}`}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="text-sm font-medium text-gray-800" data-testid={`text-task-title-${task.id}`}>
                    {task.title}
                  </h4>
                  <div className="flex items-center space-x-1">
                    {getSourceIcon(task.source)}
                    {getPriorityBadge(task.priority)}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500" data-testid={`text-task-due-${task.id}`}>
                    {formatDueDate(task.dueAt || null) || (task.estimateMins ? `Est: ${task.estimateMins} min` : '')}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => markTaskDone(task)}
                    disabled={updateTaskMutation.isPending}
                    className="bg-green-600 text-white hover:bg-green-700 text-xs px-2 py-1 h-auto"
                    data-testid={`button-done-task-${task.id}`}
                  >
                    <Check className="h-3 w-3 mr-1" />
                    Done
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Done Section */}
        <div className="p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center">
            <Check className="h-4 w-4 text-green-600 mr-2" />
            Done Today
            <Badge className="ml-2 bg-green-100 text-green-700 text-xs">
              {doneTasks.length}
            </Badge>
          </h3>
          
          {doneTasks.map(task => (
            <Card key={task.id} className="mb-2 bg-gray-50 opacity-75" data-testid={`card-done-task-${task.id}`}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm text-gray-600 line-through" data-testid={`text-task-title-${task.id}`}>
                    {task.title}
                  </h4>
                  <Check className="h-4 w-4 text-green-600" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
