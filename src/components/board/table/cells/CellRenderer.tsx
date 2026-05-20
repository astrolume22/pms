import { TaskNameCell } from './TaskNameCell';
import { TextCell } from './TextCell';
import { LabelCell } from './LabelCell';
import { PeopleCell } from './PeopleCell';
import { DateCell } from './DateCell';
import { NumbersCell } from './NumbersCell';
import { CheckboxCell } from './CheckboxCell';
import { LinkCell } from './LinkCell';
import type { CellProps } from './cellTypes';

export function CellRenderer(props: CellProps) {
  switch (props.column.column_type) {
    case 'task_name': return <TaskNameCell {...props} />;
    case 'text':      return <TextCell {...props} />;
    case 'status':    return <LabelCell {...props} multi={false} />;
    case 'priority':  return <LabelCell {...props} multi={false} />;
    case 'dropdown':  return <LabelCell {...props} multi />;
    case 'people':    return <PeopleCell {...props} />;
    case 'date':      return <DateCell {...props} />;
    case 'numbers':   return <NumbersCell {...props} />;
    case 'checkbox':  return <CheckboxCell {...props} />;
    case 'link':      return <LinkCell {...props} />;
    default:          return <TextCell {...props} />;
  }
}
