import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Scene 6 — draggable grouped list (task board).
 */

export type ListProviderProps = {
  children: ReactNode
  onDragEnd: (event: DragEndEvent) => void
  className?: string
}

export const ListProvider = ({ children, onDragEnd, className }: ListProviderProps) => {
  // A small activation distance keeps plain clicks (open the task) working
  // alongside drags on the same element.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      onDragEnd={onDragEnd}
    >
      <div className={cn('flex flex-col gap-4 lg:flex-row lg:items-start', className)}>
        {children}
      </div>
    </DndContext>
  )
}

export type ListGroupProps = {
  id: string
  children: ReactNode
  className?: string
}

export const ListGroup = ({ id, children, className }: ListGroupProps) => {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[8rem] flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface transition-colors',
        isOver && 'border-brand/60 bg-surface-2',
        className,
      )}
    >
      {children}
    </div>
  )
}

export type ListHeaderProps = {
  name: string
  color: string
  count?: number
  className?: string
}

export const ListHeader = ({ name, color, count, className }: ListHeaderProps) => (
  <div
    className={cn(
      'flex shrink-0 items-center gap-2 border-b border-border bg-surface-2 px-3 py-2.5',
      className,
    )}
  >
    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
    <p className="m-0 text-sm font-semibold">{name}</p>
    {typeof count === 'number' && (
      <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-xs text-muted">
        {count}
      </span>
    )}
  </div>
)

export type ListItemsProps = {
  children: ReactNode
  className?: string
}

export const ListItems = ({ children, className }: ListItemsProps) => (
  <div className={cn('scroll-thin flex flex-1 flex-col gap-2 overflow-y-auto p-3', className)}>
    {children}
  </div>
)

export type ListItemProps = {
  id: string
  parent: string
  index: number
  children: ReactNode
  className?: string
}

export const ListItem = ({ id, parent, index, children, className }: ListItemProps) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    data: { index, parent },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'cursor-grab rounded-lg border border-border bg-background p-3 shadow-sm transition-shadow',
        isDragging && 'cursor-grabbing opacity-80 shadow-lg',
        className,
      )}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        zIndex: isDragging ? 50 : undefined,
      }}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  )
}
