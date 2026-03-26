import { useTranslation } from 'react-i18next';
import PageWrapper from '../../../common/base/PageWrapper';
import { useHomeViewModel } from '../viewmodel/useHomeViewModel';
import RouterManager from '../../../common/router/RouterManager';

export default function HomePage() {
  const { t } = useTranslation();
  const vm = useHomeViewModel();

  return (
    <PageWrapper loading={vm.loading} error={vm.error}>
      <main className="page-shell">
        <section className="page-card">
          <h1 className="page-title">{t('pages_home_title')}</h1>
          <p className="page-desc">{vm.data?.desc ?? t('pages_home_desc')}</p>
          <button className="page-action" type="button" onClick={() => RouterManager.back()}>
            Back
          </button>
        </section>
      </main>
    </PageWrapper>
  );
}
