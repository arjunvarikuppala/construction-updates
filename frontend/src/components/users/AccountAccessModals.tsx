/**
 * In-Charge Accounts: the MD sets or changes an in-charge's mobile number.
 * Every account needs a mobile number (the MD can't set anyone's password).
 */
import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../common/Modal.js';
import { Button } from '../common/Button.js';
import { Input } from '../common/Input.js';
import { api, ApiError } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.js';
import { User } from '../../types/index.js';
import { normalizeIndianMobile, formatMobile, MOBILE_ERROR, MOBILE_HELP } from '../../utils/phone.js';

const idOf = (u: User) => u.id || (u as any)._id;

export const EditMobileModal: React.FC<{ user: User; onClose: () => void }> = ({ user, onClose }) => {
  const queryClient = useQueryClient();
  const { success } = useToast();
  const [value, setValue] = useState(user.phone ? formatMobile(user.phone) : '');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: (phone: string) => api.put(`/users/in-charge/${idOf(user)}`, { phone }),
    onSuccess: () => {
      success('Mobile number saved');
      queryClient.invalidateQueries({ queryKey: ['in-charge-users'] });
      onClose();
    },
    onError: (err: any) => setError(err instanceof ApiError ? err.message : 'Could not save'),
  });
  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      title={`Mobile number · ${user.name}`}
      description="Every account needs a mobile number."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            isLoading={save.isPending}
            onClick={() => {
              const n = normalizeIndianMobile(value);
              if (!n) return setError(MOBILE_ERROR);
              save.mutate(n);
            }}
          >
            Save
          </Button>
        </div>
      }
    >
      <Input
        label="Mobile number"
        type="tel"
        inputMode="numeric"
        placeholder="+91 98765 43210"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError('');
        }}
        error={error}
        helperText={MOBILE_HELP}
      />
    </Modal>
  );
};
