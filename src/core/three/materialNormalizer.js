/**
 * 材质工具。
 *
 * M0 只提供“无材质格式（STL/PLY）的默认黏土材质”；
 * M1 会在此基础上扩展完整的材质归一化（Phong → Standard、着色模式切换与还原）。
 */

import { Color, DoubleSide, MeshStandardMaterial } from 'three'

/** 默认黏土色：中性灰，便于观察形体而不被颜色干扰 */
export const CLAY_COLOR = 0xb9bcc3

/**
 * 为没有自带材质的几何体创建默认材质。
 *
 * side 用 DoubleSide 是刻意的：STL/PLY 常见法线朝向不一致（尤其来自扫描或
 * 布尔运算的模型），单面渲染会看到“破洞”，双面渲染更符合查看器“先看清”的目标。
 */
export function createDefaultMaterial({ vertexColors = false, name = 'mv-default' } = {}) {
  return new MeshStandardMaterial({
    name,
    color: new Color(CLAY_COLOR),
    metalness: 0.1,
    roughness: 0.65,
    side: DoubleSide,
    vertexColors,
  })
}
