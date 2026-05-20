import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Modal } from './Modal';
import { EmojiPicker } from './EmojiPicker';
import { Spinner } from './Spinner';
import { useCreateBoard } from '@/hooks/boards';
import type { BoardType } from '@/lib/database.types';
import { cn } from '@/lib/cn';

interface CreateBoardModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateBoardModal({ open, onClose }: CreateBoardModalProps) {
  const navigate = useNavigate();
  const create = useCreateBoard();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('📋');
  const [type, setType] = useState<BoardType>('main');

  // Reset form whenever the modal opens.
  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setIcon('📋');
      setType('main');
    }
  }, [open]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Board name is required');
      return;
    }
    try {
      const board = await create.mutateAsync({
        name,
        description,
        icon_emoji: icon,
        board_type: type,
      });
      toast.success(`Board "${board.name}" created`);
      onClose();
      navigate({ to: '/w/$workspace/b/$boardId', params: { workspace: 'main', boardId: board.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create board');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create new board"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            type="submit"
            form="create-board-form"
            disabled={create.isPending}
            className="btn-primary"
          >
            {create.isPending && <Spinner className="h-3 w-3 mr-2" />}
            Create board
          </button>
        </>
      }
    >
      <form id="create-board-form" onSubmit={onSubmit} className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-text-secondary font-medium">Icon</span>
            <EmojiPicker value={icon} onChange={setIcon} />
          </div>
          <div className="flex-1">
            <label className="block">
              <span className="block text-xs uppercase tracking-wide text-text-secondary font-medium mb-1">
                Board name
              </span>
              <input
                type="text"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Q3 product roadmap"
                autoFocus
                required
              />
            </label>
          </div>
        </div>

        <label className="block">
          <span className="block text-xs uppercase tracking-wide text-text-secondary font-medium mb-1">
            Description <span className="text-text-disabled normal-case font-normal">(optional)</span>
          </span>
          <textarea
            className="input min-h-[72px] py-2 resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this board for?"
            rows={3}
          />
        </label>

        <fieldset>
          <legend className="text-xs uppercase tracking-wide text-text-secondary font-medium mb-2">
            Board type
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <TypeOption
              checked={type === 'main'}
              onChange={() => setType('main')}
              title="Main"
              description="Visible to everyone in the workspace."
            />
            <TypeOption
              checked={type === 'private'}
              onChange={() => setType('private')}
              title="Private"
              description="Only people you invite can see it."
            />
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

function TypeOption({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        'cursor-pointer border rounded-base p-3 transition-colors duration-100',
        checked ? 'border-brand bg-selected' : 'border-border-medium hover:bg-hover',
      )}
    >
      <input type="radio" name="board-type" className="sr-only" checked={checked} onChange={onChange} />
      <p className={cn('text-sm font-medium', checked && 'text-brand')}>{title}</p>
      <p className="text-xs text-text-secondary mt-1">{description}</p>
    </label>
  );
}
