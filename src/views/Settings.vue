<template>
  <el-container class="settings">
    <el-header class="settings__header" height="52px">
      <el-button text @click="router.push('/')">← 返回查看器</el-button>
      <span class="settings__title">设置</span>
      <el-tag size="small" type="info" effect="plain">{{ capabilities.runtimeLabel }}</el-tag>
    </el-header>

    <el-main class="settings__main">
      <el-alert
        v-if="loadError"
        class="settings__alert"
        type="warning"
        :closable="false"
        show-icon
        :title="`部分设置读写失败：${loadError}`"
      />

      <el-alert
        v-if="!isTauri"
        class="settings__alert"
        type="info"
        :closable="false"
        show-icon
        title="Web 预览模式：浏览器无法访问本地绝对路径，因此只能通过文件选择或拖放打开模型，也没有目录授权与最近文件重开能力。"
      />

      <el-card v-if="isTauri" shadow="never" class="settings__card">
        <template #header>
          <div class="settings__card-header">
            <span>已授权的路径（本次运行）</span>
            <div>
              <el-button size="small" :loading="busy" @click="refreshGrants">刷新</el-button>
              <el-button size="small" type="danger" :disabled="!grants.length" @click="revokeAll">
                撤销全部
              </el-button>
            </div>
          </div>
        </template>

        <p class="settings__hint">
          查看器只对「用户主动打开或拖入的文件所在目录」开放 asset 协议读取权限，
          不会扫描磁盘。撤销后再次打开文件会重新授权。
        </p>

        <el-table :data="grants" size="small" empty-text="本次运行还没有授权任何路径">
          <el-table-column prop="path" label="路径" min-width="260" show-overflow-tooltip />
          <el-table-column label="类型" width="80">
            <template #default="{ row }">{{ row.isDirectory ? '目录' : '文件' }}</template>
          </el-table-column>
          <el-table-column label="递归" width="80">
            <template #default="{ row }">{{ row.recursive ? '是' : '否' }}</template>
          </el-table-column>
          <el-table-column label="授权时间" width="170">
            <template #default="{ row }">{{ formatTimestamp(row.grantedAtMs) }}</template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card v-if="isTauri" shadow="never" class="settings__card">
        <template #header><span>授权范围</span></template>
        <el-form label-width="150px" label-position="left">
          <el-form-item label="授权模式">
            <el-select
              :model-value="settings.grantMode"
              style="width: 320px"
              @update:model-value="settings.setGrantMode"
            >
              <el-option
                v-for="option in grantModeOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </el-form-item>
        </el-form>
        <p class="settings__hint">
          OBJ 的 .mtl 与贴图、glTF 的 .bin 常与模型文件不同层级，因此默认授权父目录整棵树；
          磁盘根目录与用户主目录会被后端拒绝（此时会自动退化为仅授权该文件）。
        </p>
      </el-card>

      <el-card shadow="never" class="settings__card">
        <template #header><span>显示与性能</span></template>
        <el-form label-width="150px" label-position="left">
          <el-form-item label="最大像素比">
            <el-slider
              :model-value="settings.maxPixelRatio"
              :min="1"
              :max="2"
              :step="0.25"
              :format-tooltip="(value) => `${value}×`"
              style="width: 320px"
              @update:model-value="settings.setMaxPixelRatio"
            />
          </el-form-item>
          <el-form-item label="默认开启转盘">
            <el-switch
              :model-value="settings.autoRotate"
              @update:model-value="settings.setAutoRotate"
            />
          </el-form-item>
          <el-form-item label="转盘速度">
            <el-slider
              :model-value="settings.autoRotateSpeed"
              :min="0.5"
              :max="8"
              :step="0.5"
              style="width: 320px"
              @update:model-value="settings.setAutoRotateSpeed"
            />
          </el-form-item>
          <el-form-item label="空闲停止渲染">
            <el-input-number
              :model-value="idleSeconds"
              :min="0"
              :max="120"
              :step="1"
              @update:model-value="onIdleSecondsChange"
            />
            <span class="settings__inline-hint">秒后停止渲染（0 = 不停止），再次操作画面会自动唤醒</span>
          </el-form-item>
        </el-form>
        <p class="settings__hint">
          高分屏上把像素比降到 1.0 能显著提升大模型帧率；此值会在下一次渲染时生效。
        </p>
      </el-card>

      <el-card shadow="never" class="settings__card">
        <template #header><span>外观</span></template>
        <el-form label-width="150px" label-position="left">
          <el-form-item label="界面主题">
            <el-radio-group
              :model-value="theme.mode"
              @update:model-value="theme.setMode($event)"
            >
              <el-radio-button v-for="item in THEME_MODES" :key="item.id" :value="item.id">
                {{ item.label }}
              </el-radio-button>
            </el-radio-group>
          </el-form-item>
        </el-form>
        <p class="settings__hint">
          界面（工具栏、侧栏、对话框）跟随主题；<strong>3D 视口底色不跟随</strong>——
          仍由「显示 → 背景」控制并默认深色，与主流三维软件一致，便于判断形体与材质。
          「跟随系统」会持续监听系统明暗切换。
        </p>
      </el-card>

      <el-card shadow="never" class="settings__card">
        <template #header><span>关于</span></template>
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="应用版本">0.1.0</el-descriptions-item>
          <el-descriptions-item label="运行环境">
            {{ capabilities.runtimeLabel }}（持久化后端：{{ capabilities.persistence }}）
          </el-descriptions-item>
          <el-descriptions-item label="技术栈">
            Tauri 2 · Vue 3 · Element Plus · Three.js（0.185）
          </el-descriptions-item>
          <el-descriptions-item label="本次已实现">
            GLB / GLTF / STL / FBX / OBJ(+MTL) / PLY / 3MF 七种格式；相机控制与 7 个标准视图；
            8 种着色模式；背景（含环境贴图）/网格/坐标轴；边界框与单位换算；层级树与可见性；
            色调映射·曝光·饱和度后处理；三点光源与环境光照预设及自定义光照主题；
            动画片段选择与播放控制；空闲停渲染；明暗主题；最近文件与按路径重开；
            模型轴向覆盖；截图导出（1×/2×/3×）；导入 HDR / EXR 环境贴图；文件关联与单实例
          </el-descriptions-item>
          <el-descriptions-item label="计划中">
            应用打包与性能回归（安装包已可产出，十万级三角面的帧率基准待补）
          </el-descriptions-item>
        </el-descriptions>
      </el-card>
    </el-main>
  </el-container>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { THEME_MODES } from '../core/theme.js'
import { capabilities, isTauri, listGrants, revokeGrants } from '../platform/index.js'
import { useDisplayStore } from '../stores/displayStore.js'
import { useSettingsStore } from '../stores/settingsStore.js'
import { useThemeStore } from '../stores/themeStore.js'
import { describeError } from '../utils/error-messages.js'
import { formatTimestamp } from '../utils/format.js'

const router = useRouter()
const display = useDisplayStore()
const settings = useSettingsStore()
const theme = useThemeStore()

const grants = ref([])
const busy = ref(false)
const loadError = ref('')

/** 空闲停渲染在界面上用「秒」，存储用毫秒 */
const idleSeconds = computed(() => Math.round((display.idleMs ?? 0) / 1000))

function onIdleSecondsChange(seconds) {
  const value = Number.isFinite(seconds) ? seconds : 0
  display.update('idleMs', Math.max(0, value) * 1000)
}

const grantModeOptions = [
  { value: 'file', label: '仅文件本身' },
  { value: 'parent', label: '父目录（不含子目录）' },
  { value: 'parent-recursive', label: '父目录及子目录（推荐）' },
]

async function refreshGrants() {
  if (!isTauri) return
  busy.value = true
  try {
    grants.value = await listGrants()
    loadError.value = ''
  } catch (error) {
    loadError.value = describeError(error)
  } finally {
    busy.value = false
  }
}

async function revokeAll() {
  try {
    await ElMessageBox.confirm('撤销后再次打开文件会重新授权，确定继续？', '撤销全部授权', {
      type: 'warning',
      confirmButtonText: '撤销',
      cancelButtonText: '取消',
    })
  } catch {
    return // 用户取消
  }

  try {
    const report = await revokeGrants()
    ElMessage.success(`已撤销 ${report.revoked} 条授权`)
    await refreshGrants()
  } catch (error) {
    ElMessage.error(describeError(error))
  }
}

onMounted(async () => {
  await settings.load()
  await refreshGrants()
})
</script>

<style scoped>
.settings {
  height: 100vh;
  /*
   * 整页滚动：应用外壳（html/body/#app）是 overflow:hidden 的固定视口（3D 视口需要它），
   * 所以设置页自己充当"整页"滚动容器 —— 头部与所有卡片一起滚，
   * 而不是让 el-main 内部出现滚动条（用户反馈的"卡片内容有滚动条"）。
   */
  overflow-y: auto;
  background-color: var(--el-bg-color-page);
}

.settings__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  border-bottom: 1px solid var(--el-border-color);
  background-color: var(--el-bg-color);
}

.settings__title {
  font-size: 16px;
  font-weight: 600;
}

el-main.settings__main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 960px;
  margin: 0 auto;
  width: 100%;
  /*
   * el-main 默认是 `flex: 1; overflow: auto`，于是"卡片列表"自己变成一个滚动区
   * （外层 100vh + 内层滚动 = 嵌套滚动条，且 flex 子项还会被压缩）。
   * 这里改成 flex: 1 0 auto（吃满剩余高度但不被压缩，内容更高时按内容撑开）+
   * overflow: visible，把滚动交给外层容器，卡片即按内容自适应高度。
   * 选择器带上 el-main 是为了稳定压过 Element Plus 的默认样式（不依赖打包顺序）。
   */
  flex: 1 0 auto;
  overflow: visible;
}

/* 卡片按内容自适应高度：flex 子项默认可收缩，会被压扁导致内容被裁或出现内部滚动条 */
.settings__card {
  flex-shrink: 0;
}

.settings__card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.settings__hint {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.settings__alert {
  margin: 0;
}

.settings__inline-hint {
  margin-left: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
