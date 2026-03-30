import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import SettingsApi from '../api/SettingsApi';
import { useAuthStore } from '../../../common/state/authStore';
import type { PaymentOrder, TokenLog } from '../model/SettingsModels';

export function useSettingsViewModel() {
  const [amountCent, setAmountCent] = useState(1000);
  const [tokenPage, setTokenPage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  const [tokenLogs, setTokenLogs] = useState<TokenLog[]>([]);
  const [paymentOrders, setPaymentOrders] = useState<PaymentOrder[]>([]);
  const queryClient = useQueryClient();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const pageSize = 20;

  const profileQuery = useQuery({
    queryKey: ['user-profile'],
    queryFn: SettingsApi.profile,
  });

  const tokenLogQuery = useQuery({
    queryKey: ['token-logs', tokenPage, pageSize],
    queryFn: () => SettingsApi.tokenLogs(tokenPage, pageSize),
  });

  const paymentOrderQuery = useQuery({
    queryKey: ['payment-orders', paymentPage, pageSize],
    queryFn: () => SettingsApi.paymentOrders(paymentPage, pageSize),
  });

  useEffect(() => {
    if (!tokenLogQuery.data) {
      return;
    }
    setTokenLogs((prev) => mergeById(prev, tokenLogQuery.data.records, tokenPage));
  }, [tokenLogQuery.data, tokenPage]);

  useEffect(() => {
    if (!paymentOrderQuery.data) {
      return;
    }
    setPaymentOrders((prev) => mergeById(prev, paymentOrderQuery.data.records, paymentPage));
  }, [paymentOrderQuery.data, paymentPage]);

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
      setPaymentPage(1);
      setPaymentOrders([]);
      void queryClient.invalidateQueries({ queryKey: ['payment-orders'] });
    },
  });

  const tokenTotal = tokenLogQuery.data?.total ?? 0;
  const paymentTotal = paymentOrderQuery.data?.total ?? 0;
  const hasMoreTokenLogs = tokenLogs.length < tokenTotal;
  const hasMorePaymentOrders = paymentOrders.length < paymentTotal;
  const loadingMoreTokenLogs = tokenLogQuery.isFetching && tokenPage > 1;
  const loadingMorePaymentOrders = paymentOrderQuery.isFetching && paymentPage > 1;

  return {
    profile: profileQuery.data,
    tokenLogs,
    paymentOrders,
    hasMoreTokenLogs,
    hasMorePaymentOrders,
    loadMoreTokenLogs: () => {
      if (!hasMoreTokenLogs || loadingMoreTokenLogs) {
        return;
      }
      setTokenPage((prev) => prev + 1);
    },
    loadMorePaymentOrders: () => {
      if (!hasMorePaymentOrders || loadingMorePaymentOrders) {
        return;
      }
      setPaymentPage((prev) => prev + 1);
    },
    loadingMoreTokenLogs,
    loadingMorePaymentOrders,
    loading: profileQuery.isPending || (tokenLogQuery.isPending && tokenPage === 1) || (paymentOrderQuery.isPending && paymentPage === 1),
    error: profileQuery.error?.message
      ?? (tokenPage === 1 ? tokenLogQuery.error?.message : null)
      ?? (paymentPage === 1 ? paymentOrderQuery.error?.message : null)
      ?? null,
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

function mergeById<T extends { id: number }>(prev: T[], incoming: T[], page: number): T[] {
  if (page <= 1) {
    return incoming;
  }
  const merged = [...prev];
  const existed = new Set(prev.map((item) => item.id));
  for (const item of incoming) {
    if (existed.has(item.id)) {
      continue;
    }
    merged.push(item);
  }
  return merged;
}
