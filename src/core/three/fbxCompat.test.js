import { Color, Mesh, MeshPhongMaterial, Object3D } from 'three'
import { describe, expect, it, vi } from 'vitest'

import {
  cleanFbxWarning,
  collectLoaderWarnings,
  describeFbxError,
  describeFbxUnit,
  ensureUsableMaterials,
  isUnusableMaterial,
  readFbxUnitScale,
} from './fbxCompat.js'
import { CLAY_COLOR } from './materialNormalizer.js'

describe('cleanFbxWarning（把 loader 的英文告警翻成人话）', () => {
  it('去掉 loader 前缀', () => {
    expect(cleanFbxWarning('THREE.FBXLoader: 有点奇怪')).toBe('有点奇怪')
    expect(cleanFbxWarning('FBXLoader: 有点奇怪')).toBe('有点奇怪')
  })

  it('翻译已知告警：Z-up 自动转换、多层贴图、不支持的贴图通道、骨骼共用、图片格式', () => {
    expect(
      cleanFbxWarning(
        'THREE.FBXLoader: You are loading an asset with a Z-UP coordinate system. The loader just rotates the asset to transform it into Y-UP.',
      ),
    ).toContain('Z-up')

    expect(
      cleanFbxWarning(
        'THREE.FBXLoader: layered textures are not supported in three.js. Discarding all but first layer.',
      ),
    ).toContain('多层贴图')

    expect(cleanFbxWarning('THREE.FBXLoader: Bump map is not supported in three.js, skipping texture.')).toBe(
      '贴图通道「Bump」three 不支持，已跳过该贴图',
    )

    expect(
      cleanFbxWarning('THREE.FBXLoader: skeleton attached to more than one geometry is not supported.'),
    ).toContain('骨骼')

    expect(cleanFbxWarning('FBXLoader: Image type "tga" is not supported.')).toBe(
      '图片格式「tga」不受支持，该贴图已跳过',
    )
  })

  it('未知告警原样保留（只去前缀），绝不吞信息', () => {
    expect(cleanFbxWarning('THREE.FBXLoader: some brand new warning')).toBe('some brand new warning')
    expect(cleanFbxWarning('')).toBe('')
    expect(cleanFbxWarning(null)).toBe('')
  })
})

describe('collectLoaderWarnings（把 loader 的告警收集成界面提示）', () => {
  it('收集带前缀的告警并翻译，其它日志照旧输出', async () => {
    const passthrough = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, warnings } = await collectLoaderWarnings(async () => {
      console.warn('THREE.FBXLoader: layered textures are not supported in three.js. Discarding all but first layer.')
      console.warn('这是应用的普通日志')
      return 'ok'
    })

    expect(result).toBe('ok')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('多层贴图')
    // 非 FBXLoader 的日志要透传（FBX 那条已被界面接管）
    expect(passthrough).toHaveBeenCalledTimes(1)
    expect(passthrough).toHaveBeenCalledWith('这是应用的普通日志')
    passthrough.mockRestore()
  })

  it('去重并限流（同一类贴图告警可能刷几十条）', async () => {
    const { warnings } = await collectLoaderWarnings(
      async () => {
        for (let index = 0; index < 20; index += 1) {
          console.warn('THREE.FBXLoader: layered textures are not supported in three.js.')
        }
      },
      { max: 3 },
    )
    expect(warnings).toHaveLength(1)
  })

  it('回调抛错时也必须还原 console.warn（否则全局日志被永久劫持）', async () => {
    const original = console.warn
    await expect(
      collectLoaderWarnings(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(console.warn).toBe(original)
  })

  it('成功后同样还原，且没有回调时报错', async () => {
    const original = console.warn
    await collectLoaderWarnings(async () => null)
    expect(console.warn).toBe(original)
    await expect(collectLoaderWarnings(null)).rejects.toThrow()
  })
})

describe('readFbxUnitScale / describeFbxUnit（单位识别）', () => {
  it('从根对象或它的直接子节点里读到单位系数（parseScene 会 unwrap 一层）', () => {
    expect(readFbxUnitScale({ userData: { unitScaleFactor: 1 } })).toBe(1)
    const inner = { userData: { unitScaleFactor: 10 } }
    expect(readFbxUnitScale({ children: [inner] })).toBe(10)
    expect(readFbxUnitScale({ children: [{ userData: {} }] })).toBeNull()
    expect(readFbxUnitScale(null)).toBeNull()
    expect(readFbxUnitScale({ userData: { unitScaleFactor: 'cm' } })).toBeNull()
  })

  it('常见系数映射到模型单位，并给出可读提示', () => {
    expect(describeFbxUnit(1)).toMatchObject({ sourceUnit: 'cm' })
    expect(describeFbxUnit(10)).toMatchObject({ sourceUnit: 'mm' })
    expect(describeFbxUnit(100)).toMatchObject({ sourceUnit: 'm' })
    expect(describeFbxUnit(2.54)).toMatchObject({ sourceUnit: 'in' })
    expect(describeFbxUnit(1).hint).toContain('厘米')
    expect(describeFbxUnit(2.54).hint).toContain('UnitScaleFactor=2.54')
  })

  it('识别不了的系数返回 null（不猜，避免给出错的换算）', () => {
    expect(describeFbxUnit(0.1)).toBeNull()
    expect(describeFbxUnit(0)).toBeNull()
    expect(describeFbxUnit(Number.NaN)).toBeNull()
    expect(describeFbxUnit(undefined)).toBeNull()
    expect(describeFbxUnit('1')).toBeNull()
  })
})

describe('isUnusableMaterial / ensureUsableMaterials（材质兜底）', () => {
  const black = () => new MeshPhongMaterial({ color: new Color(0x000000) })
  const white = () => new MeshPhongMaterial({ color: new Color(0xffffff) })

  it('没有材质、或纯黑且没有贴图 → 不可用；纯白或有贴图 → 可用', () => {
    expect(isUnusableMaterial(null)).toBe(true)
    expect(isUnusableMaterial(undefined)).toBe(true)
    expect(isUnusableMaterial(black())).toBe(true)
    expect(isUnusableMaterial(white())).toBe(false)

    const blackWithMap = black()
    blackWithMap.map = {}
    expect(isUnusableMaterial(blackWithMap)).toBe(false)

    const vertexColored = black()
    vertexColored.vertexColors = true
    expect(isUnusableMaterial(vertexColored)).toBe(false)

    // 没有 color 字段的材质（例如某些纯贴图材质）不参与判断
    expect(isUnusableMaterial({})).toBe(false)
  })

  it('只替换不可用的网格，并返回替换数量', () => {
    const root = new Object3D()
    const broken = new Mesh(undefined, black())
    // 注意：three 的 Mesh 构造器会兜一个白色默认材质，所以"真的没有材质"必须显式置 null
    const plain = new Mesh()
    plain.material = null
    const fine = new Mesh(undefined, white())
    root.add(broken, plain, fine)

    const { replaced } = ensureUsableMaterials(root)
    expect(replaced).toBe(2)
    // 被替换的用默认黏土材质
    expect(broken.material.color.getHex()).toBe(CLAY_COLOR)
    expect(plain.material.color.getHex()).toBe(CLAY_COLOR)
    // 正常的保持原样
    expect(fine.material.color.getHex()).toBe(0xffffff)
  })

  it('数组材质只要有一个可用就整体不动（避免破坏部分正确的材质）', () => {
    const root = new Object3D()
    const mesh = new Mesh(undefined, [black(), white()])
    root.add(mesh)

    expect(ensureUsableMaterials(root)).toEqual({ replaced: 0 })
    expect(Array.isArray(mesh.material)).toBe(true)
  })

  it('没有模型时安全返回', () => {
    expect(ensureUsableMaterials(null)).toEqual({ replaced: 0 })
  })
})

describe('describeFbxError（失败原因说人话）', () => {
  it('旧版本 FBX：给出可操作的说明', () => {
    const text = describeFbxError(
      new Error('THREE.FBXLoader: FBX version not supported, FileVersion: 6100'),
    )
    expect(text).toContain('6100')
    expect(text).toContain('7.4')
  })

  it('非 FBX / 损坏文件也各有说明', () => {
    expect(describeFbxError(new Error('THREE.FBXLoader: not a binary FBX nor an ascii FBX'))).toContain(
      '不是二进制也不是 ASCII FBX',
    )
    expect(describeFbxError(new Error('Unexpected end of JSON input'))).toContain('损坏')
  })

  it('未知错误原样返回，不编造原因', () => {
    expect(describeFbxError(new Error('随便一个错误'))).toBe('随便一个错误')
    expect(describeFbxError('字符串错误')).toBe('字符串错误')
  })
})
