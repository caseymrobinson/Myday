import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import TasksPanel from "@/components/TasksPanel";
import CalendarPanel from "@/components/CalendarPanel";
import ChatPanel from "@/components/ChatPanel";
import AddTaskModal from "@/components/AddTaskModal";
import CalendarSetupModal from "@/components/CalendarSetupModal";
import { api } from "@/lib/api";

export default function Dashboard() {
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);
  const [isCalendarSetupOpen, setIsCalendarSetupOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ['/api/tasks'],
    queryFn: api.getTasks
  });

  const { data: agenda, isLoading: agendaLoading } = useQuery({
    queryKey: ['/api/agenda', selectedDate],
    queryFn: () => api.getAgenda(selectedDate)
  });

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Tasks Panel */}
      <TasksPanel 
        tasks={tasks || []}
        isLoading={tasksLoading}
        onAddTask={() => setIsAddTaskModalOpen(true)}
        onSetupCalendar={() => setIsCalendarSetupOpen(true)}
      />

      {/* Calendar Panel */}
      <CalendarPanel 
        agenda={agenda}
        isLoading={agendaLoading}
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        onToggleChat={() => setIsChatOpen(!isChatOpen)}
      />

      {/* Chat Panel */}
      {isChatOpen && (
        <ChatPanel 
          onClose={() => setIsChatOpen(false)}
        />
      )}

      {/* Add Task Modal */}
      {isAddTaskModalOpen && (
        <AddTaskModal 
          onClose={() => setIsAddTaskModalOpen(false)}
        />
      )}

      {/* Calendar Setup Modal */}
      {isCalendarSetupOpen && (
        <CalendarSetupModal 
          onClose={() => setIsCalendarSetupOpen(false)}
        />
      )}
    </div>
  );
}
