figma.showUI(__html__, { width: 400, height: 600 });

function sendSelectionToUI() {
  const selection = figma.currentPage.selection;
  figma.ui.postMessage({
    type: 'selection-changed',
    hasSelection: selection.length > 0,
    selectionCount: selection.length
  });
}

sendSelectionToUI();
figma.on('selectionchange', sendSelectionToUI);

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'process-images') {
    const { imageDataList, imageMetadata, scaleMode } = msg;
    await processImagesAndCreateComponents(imageDataList, imageMetadata, scaleMode);
  } else if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};

// Base64 디코딩 함수
function base64ToBytes(base64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = [];
  let i = 0;
  
  base64 = base64.replace(/[^A-Za-z0-9+/]/g, '');
  
  while (i < base64.length) {
    const a = chars.indexOf(base64.charAt(i++));
    const b = chars.indexOf(base64.charAt(i++));
    const c = chars.indexOf(base64.charAt(i++));
    const d = chars.indexOf(base64.charAt(i++));
    
    const bitmap = (a << 18) | (b << 12) | (c << 6) | d;
    
    result.push((bitmap >> 16) & 255);
    if (c !== 64) result.push((bitmap >> 8) & 255);
    if (d !== 64) result.push(bitmap & 255);
  }
  
  return new Uint8Array(result);
}

async function processImagesAndCreateComponents(imageDataList, imageMetadata = [], scaleMode = 'fill') {
  const selection = figma.currentPage.selection;
  
  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'error',
      message: '이미지 영역을 선택해주세요.'
    });
    return;
  }

  try {
    console.log('이미지 처리 시작, 이미지 개수:', imageDataList.length);
    console.log('스케일 모드:', scaleMode);
    
    let selectedNode = selection[0];
    console.log('선택된 노드 타입:', selectedNode.type);
    console.log('선택된 노드 이름:', selectedNode.name);
    
    // ⭐ 핵심: 어떤 타입이든 일단 복사 가능한 최상위 노드 찾기
    let targetFrame = selectedNode;
    let originalImageArea = selectedNode;
    
    // 1. 인스턴스인 경우 처리
    if (selectedNode.type === 'INSTANCE') {
      console.log('🔄 인스턴스 감지됨');
      targetFrame = selectedNode;
      originalImageArea = null;
    } else {
      // 2. 일반 노드인 경우
      while (targetFrame.parent && targetFrame.parent.type !== 'PAGE') {
        targetFrame = targetFrame.parent;
      }
      originalImageArea = selectedNode;
    }

    console.log('✅ 복사할 대상:', targetFrame.name || targetFrame.type);

    // 원본 위치 정보 저장
    const originalX = targetFrame.x;
    const originalY = targetFrame.y;
    const originalWidth = targetFrame.width;
    const originalHeight = targetFrame.height;

    // ⭐ 그리드 배치 설정
    const maxPerRow = 20; // 한 줄에 최대 20개
    const horizontalSpacing = 50; // 가로 간격
    const verticalSpacing = 50; // 세로 간격

    console.log(`📐 그리드 배치: 한 줄 최대 ${maxPerRow}개, 총 ${Math.ceil(imageDataList.length / maxPerRow)}행`);

    // 모든 이미지에 대해 노드 복사
    const createdNodes = [];
    
    for (let i = 0; i < imageDataList.length; i++) {
      const imageData = imageDataList[i];
      const imageMeta = imageMetadata[i] || {};
      
      console.log(`${i+1}번째 노드 복사 중`);
      
      try {
        // ⭐ 어떤 타입이든 일단 복사
        const clonedNode = targetFrame.clone();
        
        // ⭐ 복사된 노드 이름에 번호 추가
        const originalName = targetFrame.name || targetFrame.type;
        clonedNode.name = `${originalName} ${i + 1}`;
        console.log(`📛 노드 이름 설정: "${clonedNode.name}"`);
        
        // 복사된 노드에서 이미지 넣을 곳 찾기
        let imageTarget = null;
        
        if (selectedNode.type === 'INSTANCE') {
          imageTarget = findAnyImageNode(clonedNode);
        } else {
          if (originalImageArea === targetFrame) {
            imageTarget = clonedNode;
          } else {
            imageTarget = findCorrespondingNode(originalImageArea, targetFrame, clonedNode);
          }
        }
        
        // 이미지 넣기
        if (imageTarget && 'fills' in imageTarget) {
          await insertImageIntoNode(imageTarget, imageData, scaleMode, imageMeta);
          console.log(`✅ ${i+1}번째 이미지 적용 완료`);
        } else {
          console.warn(`⚠️ ${i+1}번째에서 이미지 넣을 곳을 찾지 못함, 기본 위치에 Rectangle 생성`);
          
          const rect = figma.createRectangle();
          rect.resize(200, 150);
          rect.x = 50;
          rect.y = 50;
          
          await insertImageIntoNode(rect, imageData, scaleMode, imageMeta);
          
          if ('appendChild' in clonedNode) {
            clonedNode.appendChild(rect);
          }
        }
        
        // ⭐ 그리드 배치 계산 (한 줄에 20개씩)
        const rowIndex = Math.floor(i / maxPerRow); // 몇 번째 줄 (0부터 시작)
        const colIndex = i % maxPerRow; // 줄 내에서의 위치 (0부터 시작)
        
        // 복사된 노드 위치 계산
        const newX = originalX + (originalWidth + horizontalSpacing) * (colIndex + 1);
        const newY = originalY + (originalHeight + verticalSpacing) * rowIndex;
        
        clonedNode.x = newX;
        clonedNode.y = newY;
        
        console.log(`📍 ${i+1}번째 배치: ${rowIndex+1}행 ${colIndex+1}열 (${newX.toFixed(1)}, ${newY.toFixed(1)})`);
        
        // Page에 추가
        figma.currentPage.appendChild(clonedNode);
        createdNodes.push(clonedNode);
        
      } catch (nodeError) {
        console.error(`${i+1}번째 노드 처리 중 오류:`, nodeError);
        // 개별 노드 오류는 무시하고 계속 진행
      }
    }

    if (createdNodes.length > 0) {
      // 성공한 노드들 선택
      figma.currentPage.selection = [targetFrame, ...createdNodes];
      
      const scaleModeText = {
        'fill': '선택한 영역에 맞춤',
        'fit': '이미지 비율 유지',
        'crop': '선택영역 수정'
      };
      
      const totalRows = Math.ceil(imageDataList.length / maxPerRow);
      
      figma.ui.postMessage({
        type: 'success',
        message: `${createdNodes.length}개의 노드가 생성되었습니다. (${totalRows}행 배치, ${scaleModeText[scaleMode]}, 자동 번호 부여)`
      });
    } else {
      figma.ui.postMessage({
        type: 'error',
        message: '이미지를 적용할 수 있는 노드를 생성하지 못했습니다.'
      });
    }

  } catch (error) {
    console.error('전체 처리 오류:', error);
    figma.ui.postMessage({
      type: 'error',
      message: '처리 중 오류가 발생했습니다: ' + error.message
    });
  }
}

// ⭐ 어떤 노드든 이미지 넣을 수 있는 곳 찾기 (더 유연한 검색)
function findAnyImageNode(node) {
  console.log('이미지 노드 검색 중:', node.type, node.name);
  
  // 현재 노드가 이미지를 받을 수 있는지 확인
  if ('fills' in node) {
    console.log('이미지 노드 발견:', node.type);
    return node;
  }
  
  // 자식이 있으면 재귀 검색
  if ('children' in node && node.children && node.children.length > 0) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const result = findAnyImageNode(child);
      if (result) {
        return result;
      }
    }
  }
  
  return null;
}

// 원본과 대응되는 노드 찾기
function findCorrespondingNode(originalNode, originalParent, clonedParent) {
  if (originalNode === originalParent) {
    return clonedParent;
  }
  
  try {
    const path = [];
    let current = originalNode;
    
    // 경로 찾기
    while (current && current !== originalParent && current.parent) {
      const parent = current.parent;
      if (parent && parent.children) {
        const index = parent.children.indexOf(current);
        if (index !== -1) {
          path.unshift(index);
        }
      }
      current = parent;
    }
    
    // 복사본에서 같은 경로로 이동
    let targetNode = clonedParent;
    for (const index of path) {
      if (targetNode.children && targetNode.children[index]) {
        targetNode = targetNode.children[index];
      } else {
        return null;
      }
    }
    
    return targetNode;
  } catch (error) {
    console.error('노드 찾기 오류:', error);
    return null;
  }
}

async function insertImageIntoNode(node, imageData, scaleMode = 'fill', imageMeta = {}) {
  try {
    console.log('🖼️ 이미지 삽입 시작:', node.type, '스케일 모드:', scaleMode);
    
    if (!imageData || !imageData.includes('base64')) {
      throw new Error('잘못된 이미지 데이터입니다.');
    }
    
    const base64Data = imageData.split(',')[1];
    if (!base64Data) {
      throw new Error('Base64 데이터를 찾을 수 없습니다.');
    }
    
    const bytes = base64ToBytes(base64Data);
    const image = figma.createImage(bytes);
    
    if ('fills' in node) {
      // ⭐ 선택영역 수정 모드
      if (scaleMode === 'crop' && imageMeta.width && imageMeta.height) {
        console.log('📐 선택영역 수정 모드 시작');
        console.log('이미지 메타데이터:', imageMeta);
        
        // 원본 영역 크기 저장
        const originalWidth = node.width;
        const originalHeight = node.height;
        const areaRatio = originalWidth / originalHeight;
        const imageRatio = imageMeta.ratio || (imageMeta.width / imageMeta.height);
        
        console.log('영역 비율:', areaRatio.toFixed(2), '이미지 비율:', imageRatio.toFixed(2));
        
        let newWidth = originalWidth;
        let newHeight = originalHeight;
        
        // 이미지 비율에 따라 영역 크기 조정
        if (imageRatio > areaRatio) {
          // 이미지가 영역보다 가로가 더 긴 경우
          // 세로 고정, 가로를 이미지 비율만큼 늘리기
          newWidth = originalHeight * imageRatio;
          newHeight = originalHeight;
          console.log('🔄 가로형 이미지 - 가로 확장:', newWidth.toFixed(1));
        } else {
          // 이미지가 영역보다 세로가 더 긴 경우  
          // 가로 고정, 세로를 이미지 비율만큼 늘리기
          newWidth = originalWidth;
          newHeight = originalWidth / imageRatio;
          console.log('🔄 세로형 이미지 - 세로 확장:', newHeight.toFixed(1));
        }
        
        // 영역 크기 조정
        try {
          node.resize(newWidth, newHeight);
          console.log(`✅ 영역 크기 조정 완료: ${originalWidth.toFixed(1)}×${originalHeight.toFixed(1)} → ${newWidth.toFixed(1)}×${newHeight.toFixed(1)}`);
        } catch (resizeError) {
          console.warn('⚠️ 크기 조정 실패, 원본 크기 유지:', resizeError.message);
        }
        
        // FILL 모드로 이미지 적용
        node.fills = [{
          type: 'IMAGE',
          scaleMode: 'FILL',
          imageHash: image.hash
        }];
        
        console.log('✅ 선택영역 수정 완료');
        
      } else {
        // ⭐ 기본 모드들 (선택한 영역에 맞춤, 이미지 비율 유지)
        let figmaScaleMode;
        switch (scaleMode) {
          case 'fit':
            figmaScaleMode = 'FIT';
            console.log('📏 이미지 비율 유지 모드');
            break;
          case 'fill':
          default:
            figmaScaleMode = 'FILL';
            console.log('📏 선택한 영역에 맞춤 모드');
            break;
        }
        
        node.fills = [{
          type: 'IMAGE',
          scaleMode: figmaScaleMode,
          imageHash: image.hash
        }];
      }
      
      console.log('✅ 이미지 적용 성공');
    } else {
      throw new Error('이미지를 적용할 수 없는 노드입니다.');
    }
    
  } catch (error) {
    console.error('❌ 이미지 삽입 오류:', error);
    throw error;
  }
}