import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_UP_AXIS,
  ModelOrientation,
  UP_AXIS_MODES,
  Z_UP_ROTATION,
  convertDirection,
  createUpAxisQuaternion,
  resolveUpAxisMode,
  shouldConvertUpAxis,
} from './orientation.js'

describe('UP_AXIS_MODES', () => {
  it('三个模式 id 唯一且可解析', () => {
    const ids = UP_AXIS_MODES.map((mode) => mode.id)
    expect(ids).toEqual(['auto', 'keep', 'z-up'])
    expect(new Set(ids).size).toBe(ids.length)
    expect(resolveUpAxisMode('z-up')?.id).toBe('z-up')
    expect(resolveUpAxisMode('nope')).toBe(null)
    expect(resolveUpAxisMode(undefined)).toBe(null)
  })
})

describe('shouldConvertUpAxis', () => {
  it('auto：只有 3MF 自动转换（大小写不敏感）', () => {
    expect(shouldConvertUpAxis({ upAxis: 'auto', formatId: '3mf' })).toBe(true)
    expect(shouldConvertUpAxis({ upAxis: 'auto', formatId: '3MF' })).toBe(true)
    expect(shouldConvertUpAxis({ upAxis: 'auto', formatId: 'fbx' })).toBe(false)
    expect(shouldConvertUpAxis({ upAxis: 'auto', formatId: 'obj' })).toBe(false)
  })

  it('keep 永不转换，z-up 强制转换', () => {
    expect(shouldConvertUpAxis({ upAxis: 'keep', formatId: '3mf' })).toBe(false)
    expect(shouldConvertUpAxis({ upAxis: 'z-up', formatId: 'glb' })).toBe(true)
  })

  it('缺省与非法值按 auto 处理', () => {
    expect(shouldConvertUpAxis()).toBe(false)
    expect(shouldConvertUpAxis({ upAxis: 'nope', formatId: '3mf' })).toBe(true)
    expect(DEFAULT_UP_AXIS).toBe('auto')
  })
})

describe('createUpAxisQuaternion / convertDirection', () => {
  it('把 +Z 转到 +Y（Z-up → Y-up）', () => {
    const converted = new Vector3(0, 0, 1).applyQuaternion(createUpAxisQuaternion())
    expect(converted.x).toBeCloseTo(0, 6)
    expect(converted.y).toBeCloseTo(1, 6)
    expect(converted.z).toBeCloseTo(0, 6)
  })

  it('把 +Y 转到 -Z', () => {
    const converted = new Vector3(0, 1, 0).applyQuaternion(createUpAxisQuaternion())
    expect(converted.y).toBeCloseTo(0, 6)
    expect(converted.z).toBeCloseTo(-1, 6)
  })

  it('convertDirection 只在需要时转换', () => {
    const kept = convertDirection([0, 0, 1], { upAxis: 'keep' })
    expect(kept.z).toBeCloseTo(1, 6)

    const converted = convertDirection([0, 0, 1], { upAxis: 'z-up' })
    expect(converted.y).toBeCloseTo(1, 6)
  })

  it('非法旋转分量不产生 NaN', () => {
    const quaternion = createUpAxisQuaternion([Number.NaN, 0, 0])
    expect(Number.isFinite(quaternion.x)).toBe(true)
    expect(Number.isFinite(quaternion.w)).toBe(true)
    expect(Z_UP_ROTATION).toHaveLength(3)
  })
})

describe('ModelOrientation', () => {
  it('apply 后姿态改变，restore/keep 后完全还原', () => {
    const object = new Object3D()
    const orientation = new ModelOrientation(object)
    expect(orientation.isPristine).toBe(true)

    expect(orientation.apply({ upAxis: 'z-up' })).toBe(true)
    expect(orientation.isPristine).toBe(false)

    expect(orientation.apply({ upAxis: 'keep' })).toBe(false)
    expect(orientation.isPristine).toBe(true)
  })

  it('反复切换不累积旋转（幂等）', () => {
    const object = new Object3D()
    const orientation = new ModelOrientation(object)
    orientation.apply({ upAxis: 'z-up' })
    const first = object.quaternion.clone()

    orientation.apply({ upAxis: 'keep' })
    orientation.apply({ upAxis: 'z-up' })
    expect(object.quaternion.equals(first)).toBe(true)
  })

  it('保留模型自带姿态：在原始四元数基础上叠加世界空间旋转', () => {
    const object = new Object3D()
    object.rotation.set(0.3, 0.7, 0.1)
    object.updateMatrixWorld(true)
    const original = object.quaternion.clone()

    const orientation = new ModelOrientation(object)
    orientation.apply({ upAxis: 'z-up' })

    // 世界空间预乘：等于"先按修正旋转，再施加模型自带姿态"
    const expected = createUpAxisQuaternion().multiply(original)
    expect(object.quaternion.equals(expected)).toBe(true)

    orientation.restore()
    expect(object.quaternion.equals(original)).toBe(true)
  })

  it('auto 模式下 3MF 转换、其它格式保持', () => {
    const threeMf = new Object3D()
    expect(new ModelOrientation(threeMf).apply({ upAxis: 'auto', formatId: '3mf' })).toBe(true)

    const glb = new Object3D()
    expect(new ModelOrientation(glb).apply({ upAxis: 'auto', formatId: 'glb' })).toBe(false)
    expect(glb.quaternion.equals(new Object3D().quaternion)).toBe(true)
  })

  it('缺少对象时立即报错', () => {
    expect(() => new ModelOrientation(null)).toThrow()
  })
})

describe('轴向修正 + 摆放的组合语义（引擎切换 upAxis 时依赖它）', () => {
  /** 造一个"高瘦"的 Z-up 盒子：Z 方向最长，转换后应变成 Y 方向最长 */
  function createZUpBox() {
    const root = new Object3D()
    const mesh = new Mesh(new BoxGeometry(1, 2, 4), new MeshBasicMaterial())
    root.add(mesh)
    root.updateMatrixWorld(true)
    return root
  }

  it('切成 z-up 后包围盒的 Y/Z 尺寸互换（尺寸、贴地与相机都跟着变）', () => {
    const root = createZUpBox()

    const before = new Box3().setFromObject(root)
    const beforeSize = before.getSize(new Vector3())

    const orientation = new ModelOrientation(root)
    expect(orientation.apply({ upAxis: 'z-up', formatId: 'fbx' })).toBe(true)

    const afterSize = new Box3().setFromObject(root).getSize(new Vector3())
    expect(afterSize.y).toBeCloseTo(beforeSize.z, 5)
    expect(afterSize.z).toBeCloseTo(beforeSize.y, 5)
    expect(afterSize.x).toBeCloseTo(beforeSize.x, 5)
  })

  it('在 keep / z-up / auto 之间反复切换：尺寸始终与目标模式一致，不累积旋转', () => {
    const root = createZUpBox()
    const orientation = new ModelOrientation(root)

    const originalSize = new Box3().setFromObject(root).getSize(new Vector3()).clone()

    const sequence = ['keep', 'z-up', 'auto', 'z-up', 'keep', 'auto', 'keep']
    for (const upAxis of sequence) {
      orientation.apply({ upAxis, formatId: 'fbx' })
      const size = new Box3().setFromObject(root).getSize(new Vector3())
      if (upAxis === 'keep' || upAxis === 'auto') {
        // auto 对 FBX 不猜（只有 3MF 自动转），因此与 keep 等价
        expect(size.y).toBeCloseTo(originalSize.y, 5)
        expect(size.z).toBeCloseTo(originalSize.z, 5)
      } else {
        expect(size.y).toBeCloseTo(originalSize.z, 5)
        expect(size.z).toBeCloseTo(originalSize.y, 5)
      }
    }
  })
})
