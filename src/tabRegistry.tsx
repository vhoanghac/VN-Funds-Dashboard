import type { ReactElement } from 'react'
import type { CalculatorId, DashboardState, FundMeta } from './types'
import type { DcaShareState, LsDcaShareState, ShareUrlState } from './utils/shareUrl'
import { CompareTab } from './components/CompareTab'
import { DCAPanel } from './components/DCAPanel'
import { LumpSumDCAPanel } from './components/LumpSumDCAPanel'
import { FundAnalysisPanel } from './components/FundAnalysisPanel'
import { OverlapPanel } from './components/OverlapPanel'
import { RebalanceSensitivityPanel } from './components/RebalanceSensitivityPanel'
import { TacticalAllocationPanel } from './components/TacticalAllocationPanel'
import { BitcoinPanel } from './components/BitcoinPanel'
import { WallOfWorryPanel } from './components/WallOfWorryPanel'
import { CalculatorTab } from './components/calculators/CalculatorTab'
import { MethodologyPanel } from './components/MethodologyPanel'
import { ChangelogPanel } from './components/ChangelogPanel'

/**
 * Nguồn duy nhất của danh sách tab.
 *
 * Mỗi tab là một manifest: id (tên trong URL), nhãn hiển thị, và cách render.
 * App.tsx chỉ duyệt registry này. Thêm tab = thêm một entry ở đây, không sửa
 * App.tsx (đúng ô tick 1.1 GRAND_PLAN: "Thêm tab = thêm 1 file, không sửa App.tsx").
 *
 * `keepMounted`: true = ẩn bằng CSS khi không active để GIỮ STATE (người dùng
 * đang chỉnh thông số DCA qua tab khác rồi quay lại vẫn còn nguyên). false =
 * mount khi active, unmount khi rời (chỉ áp cho tab nhẹ, mất số nhập không sao).
 *
 * `wrapperClass`: class tùy chọn gắn vào div bọc panel (vd `compare-content` mà
 * CSS đang dùng để style tiêu đề của tab So Sánh). Không khai báo thì để trống.
 */

/** Kiểu id của tab. Khai báo tay ở đây (12 giá trị), registry và các file khác
 * đều suy từ nó — thêm tab phải thêm id vào union này VÀ một entry trong registry. */
export type TabId =
  | 'compare' | 'dca' | 'lsdca' | 'fundanalysis' | 'overlap'
  | 'rebalance' | 'tactical' | 'bitcoin' | 'wallofworry'
  | 'calculator' | 'methodology' | 'changelog'

/** Manifest của một tab trong registry. */
export interface TabManifest {
  id: TabId
  label: string
  /** true = giữ state khi ẩn bằng CSS; false = mount khi active */
  keepMounted: boolean
  /** Class tùy chọn gắn vào div bọc panel (vd `compare-content` để CSS style tiêu đề). */
  wrapperClass?: string
  render: (ctx: TabContext) => ReactElement
}

/** Những thứ mọi tab có thể cần, do App.tsx chuẩn bị (handler ổn định qua useCallback). */
export interface TabContext {
  metadata: FundMeta[]
  state: DashboardState
  updateState: (updates: Partial<DashboardState>) => void
  dcaUrlParams: ShareUrlState<Partial<DcaShareState>>
  lsDcaUrlParams: ShareUrlState<Partial<LsDcaShareState>>
  onChangeFunds: (funds: string[]) => void
  onChangeDateFrom: (v: string | null) => void
  onChangeDateTo: (v: string | null) => void
  onChangeRollingPeriod: (p: number) => void
  onSelectCalculator: (id: CalculatorId) => void
}

export const TAB_REGISTRY: TabManifest[] = [
  {
    id: 'compare',
    label: 'So Sánh',
    keepMounted: true,
    wrapperClass: 'compare-content',
    render: ({ metadata, state, onChangeFunds, onChangeDateFrom, onChangeDateTo, onChangeRollingPeriod }: TabContext): ReactElement => (
      <CompareTab
        metadata={metadata}
        funds={state.funds}
        dateFrom={state.dateFrom}
        dateTo={state.dateTo}
        rollingPeriod={state.rollingPeriod}
        onChangeFunds={onChangeFunds}
        onChangeDateFrom={onChangeDateFrom}
        onChangeDateTo={onChangeDateTo}
        onChangeRollingPeriod={onChangeRollingPeriod}
      />
    ),
  },
  {
    id: 'dca',
    label: 'DCA',
    keepMounted: true,
    render: ({ metadata, state, dcaUrlParams }: TabContext): ReactElement => <DCAPanel funds={metadata} active={state.tab === 'dca'} shareUrl={dcaUrlParams} />,
  },
  {
    id: 'lsdca',
    label: 'LS vs DCA',
    keepMounted: true,
    render: ({ metadata, state, lsDcaUrlParams }: TabContext): ReactElement => <LumpSumDCAPanel funds={metadata} active={state.tab === 'lsdca'} shareUrl={lsDcaUrlParams} />,
  },
  {
    id: 'fundanalysis',
    label: 'Phân Tích Quỹ',
    keepMounted: true,
    render: ({ metadata }: TabContext): ReactElement => <FundAnalysisPanel funds={metadata} />,
  },
  {
    id: 'overlap',
    label: 'Overlap',
    keepMounted: true,
    render: ({ metadata }: TabContext): ReactElement => <OverlapPanel funds={metadata} />,
  },
  {
    id: 'rebalance',
    label: 'Tái Cân Bằng',
    keepMounted: true,
    render: ({ metadata }: TabContext): ReactElement => <RebalanceSensitivityPanel funds={metadata} />,
  },
  {
    id: 'tactical',
    label: 'Chiến Thuật Phân Bổ',
    keepMounted: true,
    render: ({ metadata }: TabContext): ReactElement => <TacticalAllocationPanel funds={metadata} />,
  },
  {
    id: 'bitcoin',
    label: 'Bitcoin',
    keepMounted: true,
    render: ({ metadata }: TabContext): ReactElement => <BitcoinPanel funds={metadata} />,
  },
  {
    id: 'wallofworry',
    label: 'Wall of Worry',
    keepMounted: true,
    render: (): ReactElement => <WallOfWorryPanel />,
  },
  {
    id: 'calculator',
    label: 'Máy Tính',
    keepMounted: false,
    render: ({ state, onSelectCalculator }: TabContext): ReactElement => (
      <CalculatorTab calcId={state.calcId} onSelect={onSelectCalculator} />
    ),
  },
  {
    id: 'methodology',
    label: 'Minh Bạch Hoá',
    keepMounted: false,
    render: (): ReactElement => <MethodologyPanel />,
  },
  {
    id: 'changelog',
    label: 'Changelog',
    keepMounted: false,
    render: (): ReactElement => <ChangelogPanel />,
  },
] as const
