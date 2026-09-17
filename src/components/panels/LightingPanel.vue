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
          <el-radio-button value="none">无</el-radio-button>
        </el-radio-group>
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
import { useLightingStore } from '../../stores/lightingStore.js'
import { describeError } from '../../utils/error-messages.js'
import LightSourceEditor from './LightSourceEditor.vue'

const lighting = useLightingStore()
const themeName = ref('')
const saving = ref(false)

const environment = computed(() => lighting.lighting.environment)
const ambient = computed(() => lighting.lighting.ambient)
const lights = computed(() => lighting.lighting.lights)

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

.lighting-panel__alert {
  margin: 0;
}

.lighting-panel__desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
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
