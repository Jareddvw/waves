/**
 * The main simulation logic.
 */
import { FBO } from './lib/classes/FBO'
import { getFBOs, getPrograms } from './lib/utils/programs'
import { SimulationSettings, VisField } from './lib/utils/types'
import { clamp, colors, draw, drawParticles, getFpsCallback } from './lib/utils/utils'
import './style.css'

const canvas = document.getElementById('waves') as HTMLCanvasElement
canvas.width = canvas.getBoundingClientRect().width
canvas.height = canvas.getBoundingClientRect().height

if (!canvas) {
    throw new Error('No canvas found')
}
const gl = canvas.getContext('webgl2')
if (!gl) {
    throw new Error('WebGL2 not supported')
}
const gridScale = 1
const DIFFUSION_COEFFICIENT = 1.0
const DIFFUSE = false
const ADVECTION_DISSIPATION = 0.001

const selectedField = document.getElementById('field') as HTMLSelectElement
const bilerpCheckbox = document.getElementById('bilerp') as HTMLInputElement
const pauseCheckbox = document.getElementById('pause') as HTMLInputElement
const particleLinesCheckbox = document.getElementById('particleLines') as HTMLInputElement
const backwardsAdvectionCheckbox = document.getElementById('advectBackwards') as HTMLInputElement
const particleDensityInput = document.getElementById('particleDensity') as HTMLInputElement
const particleTrailSizeInput = document.getElementById('particleTrailSize') as HTMLInputElement
const pointSizeInput = document.getElementById('pointSize') as HTMLInputElement
const colorModeInput = document.getElementById('colorMode') as HTMLInputElement
const resetButton = document.getElementById('reset') as HTMLButtonElement
const haltButton = document.getElementById('halt') as HTMLButtonElement
const imageUpload = document.getElementById('imageUpload') as HTMLInputElement

/** Generates a texture that's gl.canvas.width x gl.canvas.height and contains the given image */
const makeTextureFromImage = (gl: WebGL2RenderingContext, image: HTMLImageElement): WebGLTexture => {
    const texture = gl.createTexture()
    if (!texture) {
        throw new Error('Could not create texture')
    }
    // flip image horizontally
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    return texture
}

const hideElem = (element: HTMLElement) => {
    element.classList.add('hidden')
}
const showElem = (element: HTMLElement) => {
    element.classList.remove('hidden')
}

const showOrHideElementsByClassname = (className: string, show: boolean) => {
    const elems = document.getElementsByClassName(className)
    for (let i = 0; i < elems.length; i += 1) {
        const elem = elems[i] as HTMLElement
        if (show) {
            showElem(elem)
        } else {
            hideElem(elem)
        }
    }
}

const showOrHideTrailsInput = () => {
    if (particleLinesCheckbox.checked && selectedField.value === 'particles') {
        showOrHideElementsByClassname('trails', true)
    } else {
        showOrHideElementsByClassname('trails', false)
    }
}
showOrHideTrailsInput()

const showOrHideParticleInput = () => {
    if (selectedField.value === 'particles') {
        showOrHideElementsByClassname('particles', true)
    } else {
        showOrHideElementsByClassname('particles', false)
    }
    showOrHideTrailsInput()
}
showOrHideParticleInput()


const settings: SimulationSettings = {
    visField: selectedField.value as VisField,
    rightClick: false,
    jacobiIterations: 30,
    manualBilerp: bilerpCheckbox?.checked ?? true,
    colorMode: parseInt(colorModeInput.value, 10),
    particleDensity: parseFloat(particleDensityInput.value) / 100.0,
    showParticleTrails: particleLinesCheckbox.checked,
    advectBackward: backwardsAdvectionCheckbox.checked,
    particleTrailSize: parseFloat(particleTrailSizeInput.value) / 100.0,
    particleSize: clamp(parseFloat(pointSizeInput.value), 1, 5),
    paused: pauseCheckbox.checked,

    impulseDirection: [0, 0],
    impulsePosition: [0, 0],
    impulseRadius: 0,
    impulseMagnitude: 0,
}

resetButton.addEventListener('click', () => {
    settings.paused = true
    requestAnimationFrame(() => {
        resetFields()
        settings.paused = false
        render(performance.now())
    })
})
haltButton.addEventListener('click', () => {
    settings.paused = true
    requestAnimationFrame(() => {
        haltFluid()
        settings.paused = false
        render(performance.now())
    })
})
backwardsAdvectionCheckbox.addEventListener('change', () => {
    settings.advectBackward = backwardsAdvectionCheckbox.checked
})
particleDensityInput.addEventListener('change', () => {
    settings.particleDensity = parseFloat(particleDensityInput.value) / 100.0
})
particleTrailSizeInput.addEventListener('change', () => {
    settings.particleTrailSize = parseFloat(particleTrailSizeInput.value) / 100.0
})
pointSizeInput.addEventListener('change', () => {
    settings.particleSize = clamp(parseFloat(pointSizeInput.value), 1, 5)
})
colorModeInput.addEventListener('change', () => {
    settings.colorMode = clamp(parseInt(colorModeInput.value, 10), 1, 5)
})
pauseCheckbox.addEventListener('change', () => {
    if (pauseCheckbox.checked) {
        settings.paused = true
    } else {
        settings.paused = false
        render(performance.now())
    }
})
selectedField.addEventListener('change', () => {
    settings.visField = selectedField.value as VisField
    showOrHideParticleInput()
    if (settings.paused) {
        render(performance.now())
    }
})
particleLinesCheckbox.addEventListener('change', () => {
    if (particleLinesCheckbox.checked) {
        settings.showParticleTrails = true
    } else {
        settings.showParticleTrails = false
    }
    showOrHideTrailsInput()
})
let mouseDown = false
let lastMousePos = [0, 0]
canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault()
})
canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
        settings.rightClick = true
    }
    const x = e.clientX / canvas.width
    const y = 1 - e.clientY / canvas.height
    mouseDown = true
    lastMousePos = [x, y]
})
canvas.addEventListener('mousemove', (e) => {
    if (mouseDown) {
        const x = e.clientX / canvas.width
        const y = 1 - e.clientY / canvas.height
        const diff = [x - lastMousePos[0], y - lastMousePos[1]]
        // force direction is the direction of the mouse movement
        // normalize diff for direction
        const len = Math.sqrt(diff[0] * diff[0] + diff[1] * diff[1])
        const normalizedDiff = (len === 0 || len < 0.002) ? [0, 0] : [diff[0] / len, diff[1] / len]
        settings.impulseDirection = normalizedDiff as [number, number]
        lastMousePos =  [x, y]
        settings.impulsePosition = [x, y]
        settings.impulseMagnitude = 1
        settings.impulseRadius = .0001
    }
})
canvas.addEventListener('mouseup', () => {
    if (settings.rightClick) {
        settings.rightClick = false
    }
    mouseDown = false
    settings.impulseMagnitude = 0
    settings.impulseRadius = 0
    settings.impulseDirection = [0, 0]
})

gl.clearColor(0.0, 0.0, 0.0, 1.0)
gl.clear(gl.COLOR_BUFFER_BIT)

const {
    fillColorProgram,
    externalForceProgram,
    advectionProgram,
    colorVelProgram,
    writeParticleProgram,
    particleProgram,
    jacobiProgram,
    divergenceProgram,
    gradientSubtractionProgram,
    boundaryProgram,
    copyProgram,
    advectParticleProgram,
    fadeProgram,
} = getPrograms(gl)

const {
    particlesFBO,
    divergenceFBO,
    pressureFBO,
    velocityFBO,
    dyeFBO,
} = getFBOs(gl)

const getFPS = getFpsCallback()

const prevParticlesFBO = new FBO(gl, gl.canvas.width, gl.canvas.height)
const tempTex = new FBO(gl, gl.canvas.width, gl.canvas.height)

const resetParticles = () => {
    writeParticleProgram.use()
    draw(gl, particlesFBO.writeFBO)
    particlesFBO.swap()
}
const resetDye = () => {
    fillColorProgram.use()
    fillColorProgram.setVec4('color', colors.black)
    draw(gl, dyeFBO.writeFBO)
    dyeFBO.swap()
}

const haltFluid = () => {
    // Make a fullscreen black quad texture as a starting point
    fillColorProgram.use()
    fillColorProgram.setVec4('color', colors.black)
    draw(gl, velocityFBO.writeFBO)
    draw(gl, pressureFBO.writeFBO)
    draw(gl, divergenceFBO.writeFBO)
    draw(gl, tempTex)
    velocityFBO.swap()
    pressureFBO.swap()
    divergenceFBO.swap()
}
const resetFields = () => {
    haltFluid()
    resetParticles()
    resetDye()
}
haltFluid()

imageUpload.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) {
        return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
        const image = new Image()
        image.src = e.target?.result as string
        image.onload = () => {
            const texture = makeTextureFromImage(gl, image)
            copyProgram.use()
            copyProgram.setTexture('tex', texture, 0)
            draw(gl, dyeFBO.writeFBO)
            dyeFBO.swap()
        }
    }
    reader.readAsDataURL(file)
})

let prev = performance.now()

const applyVelocityBoundary = (texelDims: [number, number]) => {
    copyProgram.use()
    copyProgram.setTexture('tex', velocityFBO.readFBO.texture, 0)
    draw(gl, tempTex)
    boundaryProgram.use()
    boundaryProgram.setUniforms({
        scale: -1,
        x: tempTex.texture,
        texelDims,
    })
    draw(gl, velocityFBO.readFBO)
}

const applyPressureBoundary = (texelDims: [number, number]) => {
    copyProgram.use()
    copyProgram.setTexture('tex', pressureFBO.readFBO.texture, 0)
    draw(gl, tempTex)
    boundaryProgram.use()
    boundaryProgram.setUniforms({
        scale: 1,
        x: tempTex.texture,
        texelDims,
    })
    draw(gl, pressureFBO.readFBO)
}

// TODO: draw lines in the direction of the velocity field.

const render = (now: number) => {
    const diff = now - prev
    const deltaT = diff === 0 ? 0.016 : Math.min((now - prev) / 1000, 0.033)
    prev = now
    const texelDims = [1.0 / gl.canvas.width, 1.0 / gl.canvas.height] as [number, number]
    const { 
        visField,
        jacobiIterations,
        manualBilerp,
        rightClick,
        colorMode,
        particleDensity,
        showParticleTrails,
        advectBackward,
        particleTrailSize,
        particleSize,
        paused,
        impulseDirection,
        impulsePosition,
        impulseRadius,
        impulseMagnitude,
    } = settings

    // External force
    externalForceProgram.use()
    externalForceProgram.setUniforms({
        impulseDirection,
        impulsePosition,
        impulseMagnitude,
        impulseRadius,
        aspectRatio: gl.canvas.width / gl.canvas.height,
        velocity: velocityFBO.readFBO.texture,
    })
    if (visField === 'dye' && rightClick) {
        externalForceProgram.setTexture('velocity', dyeFBO.readFBO.texture, 0)
        externalForceProgram.setFloat('impulseRadius', 0.0005)
        draw(gl, dyeFBO.writeFBO)
        dyeFBO.swap()
    } else {
        draw(gl, velocityFBO.writeFBO)
        velocityFBO.swap()
    }
    
    // Advection
    advectionProgram.use()
    advectionProgram.setUniforms({
        dt: deltaT,
        gridScale,
        texelDims,
        useBilerp: manualBilerp ? 1 : 0,
        velocity: velocityFBO.readFBO.texture,
        dissipation: ADVECTION_DISSIPATION,
    })
    if (visField === 'dye') {
        advectionProgram.setTexture('quantity', dyeFBO.readFBO.texture, 1)
        draw(gl, dyeFBO.writeFBO)
        dyeFBO.swap()
    }
    advectionProgram.setTexture('quantity', velocityFBO.readFBO.texture, 1)
    draw(gl, velocityFBO.writeFBO)
    velocityFBO.swap()

    if (visField === 'particles') {
        if (advectBackward) {
            // use backward advection for particles
            advectionProgram.use()
            advectionProgram.setUniforms({
                dt: -deltaT,
                gridScale,
                texelDims,
                useBilerp: manualBilerp ? 1 : 0,
                velocity: velocityFBO.readFBO.texture,
                quantity: particlesFBO.readFBO.texture,
                dissipation: 0,
            })
            draw(gl, particlesFBO.writeFBO)
            particlesFBO.swap()
        } else {
            // use forward advection for particles
            advectParticleProgram.use()
            advectParticleProgram.setUniforms({
                dt: deltaT,
                gridScale,
                texelDims,
                velocity: velocityFBO.readFBO.texture,
                quantity: particlesFBO.readFBO.texture,
            })
            draw(gl, particlesFBO.writeFBO)
            particlesFBO.swap()
        }
    }

    if (DIFFUSE) {
        // viscous diffusion with jacobi method
        const alpha = (gridScale * gridScale) / (DIFFUSION_COEFFICIENT * deltaT)
        jacobiProgram.use()
        jacobiProgram.setUniforms({
            alpha,
            rBeta: 1 / (4 + alpha),
            texelDims,
            bTexture: velocityFBO.readFBO.texture,
        })
        for (let i = 0; i < jacobiIterations; i += 1) {
            jacobiProgram.setTexture('xTexture', velocityFBO.readFBO.texture, 1)
            draw(gl, velocityFBO.writeFBO)
            velocityFBO.swap()
        }
    }

    // get divergence of velocity field
    divergenceProgram.use()
    divergenceProgram.setUniforms({
        velocity: velocityFBO.readFBO.texture,
        gridScale,
        texelDims,
    })
    draw(gl, divergenceFBO.writeFBO)
    divergenceFBO.swap()

    // poisson-pressure, laplacian(P) = div(w)
    jacobiProgram.use()
    jacobiProgram.setUniforms({
        alpha: -gridScale * gridScale,
        rBeta: 0.25,
        texelDims,
        bTexture: divergenceFBO.readFBO.texture,
    })
    for (let i = 0; i < jacobiIterations; i += 1) {
        jacobiProgram.setTexture('xTexture', pressureFBO.readFBO.texture, 1)
        draw(gl, pressureFBO.writeFBO)
        pressureFBO.swap()
    }

    applyPressureBoundary(texelDims)

    // u = w - grad(P)
    gradientSubtractionProgram.use()
    gradientSubtractionProgram.setUniforms({
        pressure: pressureFBO.readFBO.texture,
        divergentVelocity: velocityFBO.readFBO.texture,
        halfrdx: 0.5 / gridScale,
        texelDims,
    })
    draw(gl, velocityFBO.writeFBO)
    velocityFBO.swap()

    applyVelocityBoundary(texelDims)

    // visualization
    if (visField === 'particles') {
        if (showParticleTrails) {
            drawParticles(
                gl,
                particlesFBO.readFBO.texture,
                velocityFBO.readFBO.texture,
                particleProgram,
                colorMode,
                prevParticlesFBO,
                particleDensity,
                particleSize
            )
            copyProgram.use()
            copyProgram.setTexture('tex', prevParticlesFBO.texture, 0)
            draw(gl, null)
            draw(gl, tempTex)
            fadeProgram.use()
            fadeProgram.setUniforms({
                tex: tempTex.texture,
                fadeFactor: particleTrailSize,
                bgColor: colors.black,
            })
            draw(gl, prevParticlesFBO)
        } else {
            fillColorProgram.use()
            fillColorProgram.setVec4('color', colors.black)
            draw(gl, null)
            drawParticles(
                gl,
                particlesFBO.readFBO.texture,
                velocityFBO.readFBO.texture,
                particleProgram,
                colorMode,
                null,
                particleDensity,
                particleSize
            )
        }
    } else {
        colorVelProgram.use()
        colorVelProgram.setUniforms({
            colorMode,
        })
        switch (visField) {
            case 'velocity':
                colorVelProgram.setTexture('velocity', velocityFBO.readFBO.texture, 0)
                break;
            case 'pressure':
                colorVelProgram.setTexture('velocity', pressureFBO.readFBO.texture, 0)
                break;
            case 'dye':
                colorVelProgram.setTexture('velocity', dyeFBO.readFBO.texture, 0)
                colorVelProgram.setFloat('colorMode', 2)
                break;
        }
        draw(gl, null)
    }

    const fps = getFPS()
    if (fps < 50) {
        settings.jacobiIterations = 25
    }
    document.getElementById('fps')!.innerText = `FPS: ${fps.toFixed(1)}, iterations: ${jacobiIterations}`
    if (paused) {
        return
    }
    requestAnimationFrame(render)
}

render(prev)