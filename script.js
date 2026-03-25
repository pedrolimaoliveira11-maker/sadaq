function atualizarClientes() {
    const lista = document.getElementById('lista-clientes-simples');
    const select = document.getElementById('select-venda-cliente');
    lista.innerHTML = '';
    select.innerHTML = '<option value="">Selecione um cliente...</option>';
    clientes.forEach((c, i) => {
        lista.innerHTML += `<tr><td>${c}</td><td><button onclick="removerCliente(${i})">Remover</button></td></tr>`;
        select.innerHTML += `<option value="${c}">${c}</option>`;
    });
}

