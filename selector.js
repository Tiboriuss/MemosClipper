function startSelection() {
    return new Promise((resolve) => {
        // Create a transparent event catcher overlay
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'transparent'; // Completely transparent
        overlay.style.zIndex = '999999';
        overlay.style.cursor = 'crosshair';
        document.body.appendChild(overlay);

        // Selection box with hole-punch effect
        const selection = document.createElement('div');
        selection.style.border = '1px solid #2563eb';
        // The magic: a massive box-shadow creates the darkened surround while leaving the inside clear
        selection.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.4)';
        selection.style.position = 'fixed';
        selection.style.zIndex = '1000000';
        selection.style.display = 'none';
        selection.style.pointerEvents = 'none'; // Don't block the overlay
        document.body.appendChild(selection);

        let startX, startY;
        let isDrawing = false;

        function onMouseDown(e) {
            isDrawing = true;
            startX = e.clientX;
            startY = e.clientY;
            selection.style.left = `${startX}px`;
            selection.style.top = `${startY}px`;
            selection.style.width = '0px';
            selection.style.height = '0px';
            selection.style.display = 'block';
        }

        function onMouseMove(e) {
            if (!isDrawing) return;
            const currentX = e.clientX;
            const currentY = e.clientY;
            const width = Math.abs(currentX - startX);
            const height = Math.abs(currentY - startY);
            const left = Math.min(currentX, startX);
            const top = Math.min(currentY, startY);

            selection.style.left = `${left}px`;
            selection.style.top = `${top}px`;
            selection.style.width = `${width}px`;
            selection.style.height = `${height}px`;
        }

        function onMouseUp(e) {
            if (!isDrawing) return;
            isDrawing = false;

            const rect = {
                x: parseInt(selection.style.left),
                y: parseInt(selection.style.top),
                width: parseInt(selection.style.width),
                height: parseInt(selection.style.height),
                devicePixelRatio: window.devicePixelRatio
            };

            // Immediate cleanup
            overlay.remove();
            selection.remove();
            overlay.removeEventListener('mousedown', onMouseDown);
            overlay.removeEventListener('mousemove', onMouseMove);
            overlay.removeEventListener('mouseup', onMouseUp);

            // Resolve instantly - because the area inside the box was ALREADY clear, 
            // the background script's captureVisibleTab will get a clean shot.
            resolve(rect);
        }

        overlay.addEventListener('mousedown', onMouseDown);
        overlay.addEventListener('mousemove', onMouseMove);
        overlay.addEventListener('mouseup', onMouseUp);
    });
}

startSelection();
