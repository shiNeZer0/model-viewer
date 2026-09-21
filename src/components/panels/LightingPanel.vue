<template>
  <div class="lighting-panel">
    <el-alert
      v-if="lighting.loadError"
      class="lighting-panel__alert"
      type="warning"
      :closable="false"
      show-icon
      :title="`部分光照设置读写失败：${lighting.loadError}`"
    />

    <el-form label-width="72px" label-position="left" size="small">
      <el-form-item label="光照预设">
        <el-select
          :model-value="lighting.matchedPresetId ?? ''"
          placeholder="自定义"
          style="width: 100%"
          @update:model-value="onApplyPreset"
        >
          <el-option
            v-for="preset in LIGHTING_PRESETS"
            :key="preset.id"
            :label="preset.label"
            :value="preset.id"
          />
        </el-select>
      </el-form-item>
    </el-form>
    <p class="lighting-panel__desc">{{ presetDescription }}</p>

    <el-divider content-position="left">环境贴图（IBL）</el-divider>
    <el-form label-width="72px" label-position="left" size="small">
      <el-form-item label="来源">
        <el-radio-group
          :model-value="environment.source"
          @update:model-value="updateEnvironment('source', $event)"
        >
          <el-radio-button value="room">影棚</el-radio-button>
          <el-radio-button value="gradient">渐变</el-radio-button>
          <el-radio-button value="imported">导入</el-radio-button>
          <el-radio-button value="none">无</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <!-- 导入 HDR / EXR：桌面端会复制进应用数据目录，Web 端只能当次会话有效 -->
      <el-form-item v-if="environment.source === 'imported'" label="贴图">
        <div class="lighting-panel__hdr">
          <el-button size="small" :loading="importingEnv" @click="onImportEnvironment">
            {{ environment.customHdrName ? '重新导入' : '选择 HDR / EXR' }}
          </el-button>
          <el-button
            v-if="environment.customHdrName"
            size="small"
            text
            @click="onClearEnvironment"
          >
            移除
          </el-button>
        </div>
        <p v-if="environment.customHdrName" class="lighting-panel__hdr-name">
          {{ environment.customHdrName }}
        </p>
        <p class="lighting-panel__desc">
          {{
            canPersistEnvironment
              ? '已复制到应用数据目录，保存为主题后换电脑/移动原文件都不受影响。'
              : 'Web 预览下导入的贴图只对本次会话有效，刷新后会退回程序化环境。'
          }}
        </p>
      </el-form-item>

      <el-form-item label="强度">
        <el-slider
          :model-value="environment.intensity"
          :min="LIGHT_LIMITS.environmentIntensity.min"
          :max="LIGHT_LIMITS.environmentIntensity.max"
          :step="LIGHT_LIMITS.environmentIntensity.step"
          :disabled="environment.source === 'none'"
          :format-tooltip="(value) => value.toFixed(2)"
          @input="updateEnvironment('intensity', $event, false)"
          @change="updateEnvironment('intensity', $event)"
        />
      </el-form-item>

      <template v-if="environment.source === 'gradient'">
        <el-form-item label="天顶色">
          <el-color-picker
            :model-value="environment.topColor"
            @update:model-value="updateEnvironment('topColor', $event)"
          />
        </el-form-item>
        <el-form-item label="地平色">
          <el-color-picker
            :model-value="environment.horizonColor"
            @update:model-value="updateEnvironment('horizonColor', $event)"
          />
        </el-form-item>
        <el-form-item label="地面色">
          <el-color-picker
            :model-value="environment.bottomColor"
            @update:model-value="updateEnvironment('bottomColor', $event)"
          />
        </el-form-item>
      </template>
    </el-form>

    <el-divider content-position="left">环境光（半球光）</el-divider>
    <el-form label-width="72px" label-position="left" size="small">
      <el-form-item label="启用">
        <el-switch
          :model-value="ambient.enabled"
          @update:model-value="updateAmbient('enabled', $event)"
        />
      </el-form-item>
      <el-form-item label="强度">
        <el-slider
          :model-value="ambient.intensity"
          :min="LIGHT_LIMITS.ambientIntensity.min"
          :max="LIGHT_LIMITS.ambientIntensity.max"
          :step="LIGHT_LIMITS.ambientIntensity.step"
          :disabled="!ambient.enabled"
          :format-tooltip="(value) => value.toFixed(2)"
          @input="updateAmbient('intensity', $event, false)"
          @change="updateAmbient('intensity', $event)"
        />
      </el-form-item>
      <el-form-item label="天空色">
        <el-color-picker
          :model-value="ambient.skyColor"
          :disabled="!ambient.enabled"
          @update:model-value="updateAmbient('skyColor', $event)"
        />
      </el-form-item>
      <el-form-item label="地面色">
        <el-color-picker
          :model-value="ambient.groundColor"
          :disabled="!ambient.enabled"
          @update:model-value="updateAmbient('groundColor', $event)"
        />
      </el-form-item>
    </el-form>

    <el-divider content-position="left">三点光源</el-divider>

    <div class="lighting-panel__gizmos">
      <el-switch
        size="small"
        :model-value="display.showLightGizmos"
        @update:model-value="display.update('showLightGizmos', $event)"
      />
      <span class="lighting-panel__gizmos-label">在视口中显示光源</span>
    </div>
    <p class="lighting-panel__desc">
      开启后视口里会画出三盏灯：彩色圆点表示位置（关闭的灯显示为灰色）、连线指向它的照射方向，
      旁边标注角色名与强度。被模型挡住时依然可见，方便一边看位置一边调参数。
    </p>
    <LightSourceEditor
      v-for="light in lights"
      :key="light.role"
      :light="light"
      :role="roleOf(light.role)"
      @change="onLightChange"
    />

    <el-divider content-position="left">光照主题</el-divider>
    <div class="lighting-panel__save">
      <el-input v-model="themeName" size="small" placeholder="主题名称" clearable />
      <el-button size="small" type="primary" :loading="saving" @click="onSaveTheme">
        保存为主题
      </el-button>
    </div>
    <p class="lighting-panel__hint">
      主题会连同背景与色调一起保存，应用时能完整复现当前观感；同名保存即覆盖。
    </p>

    <el-table :data="lighting.themes" size="small" empty-text="还没有保存的主题">
      <el-table-column prop="name" label="名称" show-overflow-tooltip />
      <el-table-column label="操作" width="152" align="right">
        <template #default="{ row }">
          <el-button
            size="small"
            text
            :type="String(lighting.activeThemeId) === String(row.id) ? 'primary' : ''"
            @click="onApplyTheme(row.id)"
          >
            应用
          </el-button>
          <el-button size="small" text @click="onRenameTheme(row)">重命名</el-button>
          <el-button size="small" text type="danger" @click="onRemoveTheme(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, ref } from 'vue'

import { LIGHTING_PRESETS, resolvePreset } from '../../constants/presets/lightingPresets.js'
import { LIGHT_LIMITS, LIGHT_ROLES } from '../../core/three/lighting.js'
import { capabilities, pickEnvironmentSource } from '../../platform/index.js'
import { useDisplayStore } from '../../stores/displayStore.js'
import { useLightingStore } from '../../stores/lightingStore.js'
import { describeError } from '../../utils/error-messages.js'
import LightSourceEditor from './LightSourceEditor.vue'

const lighting = useLightingStore()
// 光源可视化开关存在 displayStore（与网格/坐标轴/边界框同属"视口辅助"）
const display = useDisplayStore()
const themeName = ref('')
const saving = ref(false)
const importingEnv = ref(false)

const environment = computed(() => lighting.lighting.environment)
const ambient = computed(() => lighting.lighting.ambient)
const lights = computed(() => lighting.lighting.lights)
/** 桌面端会把导入的贴图复制进应用数据目录（可跨会话），Web 端不行 */
const canPersistEnvironment = computed(() => Boolean(capabilities.persistImportedEnvironment))

const presetDescription = computed(() => {
  const preset = resolvePreset(lighting.matchedPresetId)
  if (preset) return preset.description
  return '当前为自定义光照（来自手动调节或已保存的主题）'
})

function roleOf(roleId) {
  return LIGHT_ROLES.find((role) => role.id === roleId) ?? { id: roleId, label: roleId, description: '' }
}

async function onApplyPreset(presetId) {
  if (!presetId) return
  try {
    await lighting.applyPreset(presetId)
  } catch (error) {
    ElMessage.error(describeError(error))
  }
}

async function updateAmbient(key, value, persist = true) {
  await lighting.updateAmbient({ [key]: value }, { persist })
}

async function updateEnvironment(key, value, persist = true) {
  await lighting.updateEnvironment({ [key]: value }, { persist })
}

/**
 * 导入 HDR/EXR 环境贴图。
 * 桌面端由平台层先复制进应用数据目录再授权，所以这里的 url 指向的是副本，
 * 之后移动/删除原文件都不会让已保存的主题失效。
 */
async function onImportEnvironment() {
  if (importingEnv.value) return
  importingEnv.value = true
  try {
    const source = await pickEnvironmentSource()
    if (!source) return
    await lighting.updateEnvironment({
      source: 'imported',
      customHdrName: source.sourceName,
      customHdrUrl: source.url,
      customHdrPath: source.storedPath ?? null,
      customHdrExtension: source.extension,
    })
    ElMessage.success(`已导入环境贴图：${source.sourceName}`)
  } catch (error) {
    ElMessage.error(describeError(error))
  } finally {
    importingEnv.value = false
  }
}

/**
 * 移除导入的贴图：回到渐变。
 * 刻意**不删**应用数据目录里的副本——其它主题或历史设置可能引用同一个文件，
 * 误删会让它们集体失效。
 */
async function onClearEnvironment() {
  await lighting.updateEnvironment({
    source: 'gradient',
    customHdrName: null,
    customHdrUrl: null,
    customHdrPath: null,
    customHdrExtension: null,
  })
}

async function onLightChange({ role, patch, persist }) {
  await lighting.updateLight(role, patch, { persist })
}

async function onSaveTheme() {
  saving.value = true
  try {
    await lighting.saveTheme(themeName.value)
    ElMessage.success(`已保存主题「${themeName.value.trim()}」`)
    themeName.value = ''
  } catch (error) {
    ElMessage.error(describeError(error))
  } finally {
    saving.value = false
  }
}

async function onApplyTheme(themeId) {
  try {
    await lighting.applyTheme(themeId)
    ElMessage.success('已应用主题')
  } catch (error) {
    ElMessage.error(describeError(error))
  }
}

async function onRenameTheme(row) {
  try {
    const { value } = await ElMessageBox.prompt('输入新的主题名称', '重命名主题', {
      inputValue: row.name,
      confirmButtonText: '保存',
      cancelButtonText: '取消',
    })
    await lighting.renameTheme(row.id, value)
    ElMessage.success('已重命名')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(describeError(error))
  }
}

async function onRemoveTheme(row) {
  try {
    await ElMessageBox.confirm(`删除主题「${row.name}」？`, '删除主题', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await lighting.removeTheme(row.id)
    ElMessage.success('已删除')
  } catch (error) {
    ElMessage.error(describeError(error))
  }
}
</script>

<style scoped>
.lighting-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  /* 双保险，确保这个面板**自己**能滚动，不依赖祖先的高度链：
     1) height:100% —— 祖先高度链完整时精确填满标签页内容区；
     2) max-height 由视口推导（顶栏 52 + 状态栏 30 + 标签页头约 48），
        任何一层祖先高度退化成 auto 时，面板仍能拿到确定高度，
        overflow-y 才会生效（否则百分比高度静默退化、内容被裁掉够不到）。 */
  height: 100%;
  max-height: calc(100vh - 130px);
  overflow-y: auto;
}

/*
 * 子项一律不参与收缩：面板是固定高度的 flex 列容器，若子项可被压缩，
 * flex 会把它们挤到低于内容高度；而 el-card / el-alert 自带 overflow:hidden，
 * 被挤掉的部分会**静默裁切、既看不到也滚不到**（三张光源卡片内容缺失就是这个原因）。
 * 约定：子项永远保持自然高度，溢出全部交给面板这一个滚动容器。
 */
.lighting-panel > * {
  flex-shrink: 0;
}

.lighting-panel__alert {
  margin: 0;
}

.lighting-panel__desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.lighting-panel__gizmos {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.lighting-panel__gizmos-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.lighting-panel__hdr {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lighting-panel__hdr-name {
  margin: 4px 0 0;
  font-size: 12px;
  word-break: break-all;
  color: var(--el-text-color-regular);
}

.lighting-panel__save {
  display: flex;
  gap: 8px;
}

.lighting-panel__hint {
  margin: 0 0 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
