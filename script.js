function removerCliente(index) {
    clientes.splice(index, 1);
    localStorage.setItem('db_clientes_spfc', JSON.stringify(clientes));
    atualizarClientes();
}
