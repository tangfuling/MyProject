import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import SettingsApi from '../api/SettingsApi';
import { useAuthStore } from '../../../common/state/authStore';

export function useSettingsViewModel() {
  const [amountCent, setAmountCent] = useState(1000);
  const queryClient = useQueryClient();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const profileQuery = useQuery({
    queryKey: ['user-profile'],
    queryFn: SettingsApi.profile,
  });

  const tokenLogQuery = useQuery({
    queryKey: ['token-logs'],
    queryFn: () => SettingsApi.tokenLogs(1, 20),
  });

  const updateModelMutation = useMutation({
    mutationFn: (model: string) => SettingsApi.updateModel(model),
    onSuccess: (_, model) => {
      updateProfile({ aiModel: model });
      void queryClient.invalidateQueries({ queryKey: ['user-profile'] });
    },
  });

  const payMutation = useMutation({
    mutationFn: () => SettingsApi.createPayment(amountCent),
    onSuccess: (result) => {
      window.open(result.payUrl, '_blank');
    },
  });

  return {
    profile: profileQuery.data,
    tokenLogs: tokenLogQuery.data?.records ?? [],
    loading: profileQuery.isPending || tokenLogQuery.isPending,
    error: profileQuery.error?.message ?? tokenLogQuery.error?.message ?? null,
    updateModel: (model: string) => updateModelMutation.mutate(model),
    updatingModel: updateModelMutation.isPending,
    amountCent,
    setAmountCent,
    createPayment: () => payMutation.mutate(),
    paying: payMutation.isPending,
    payError: payMutation.error?.message ?? null,
    logout: () => clearAuth(),
  };
}
